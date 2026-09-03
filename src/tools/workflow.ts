import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { FlexHttp } from "../client.js";
import type { FlexConfig } from "../config.js";
import { formatDateTime, toolError, toolJson } from "../format.js";
import { ensureDirInside, resolveDownloadPath, sanitizeFileName, uniquePath } from "../paths.js";
import { envelope, summarizeWfTask } from "../projection.js";
import { downloadOutput, templateDetailsOutput, wfTaskListOutput } from "../schema.js";

/**
 * A letöltési könyvtár: a konfigurált `FLEX_DOWNLOAD_DIR`, vagy az OS temp
 * könyvtárának `dmsone-flex` almappája. Miért almappa és nem a temp gyökere: a
 * sandbox-határ így egy csak nekünk szóló könyvtár, nem a rendszer közös temp-je,
 * ahol idegen fájlokkal ütközhetnénk.
 */
export function downloadBaseDir(config: FlexConfig): string {
  return resolve(config.downloadDir ?? join(tmpdir(), "dmsone-flex"));
}

/** A single metadata field of a workflow template, normalized for agent use. */
interface ParsedField {
  code: string;
  name?: string;
  label?: string;
  type?: string;
  required: boolean;
  default?: unknown;
  visibility?: string;
  options?: string[];
}

/** Option fields encode their choices as "|opt1;opt2;opt3" — split into an array. */
function parseOptionParams(params: unknown): string[] | undefined {
  if (typeof params !== "string" || params.trim() === "") return undefined;
  const clean = params.startsWith("|") ? params.slice(1) : params;
  const options = clean
    .split(";")
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
  return options.length > 0 ? options : undefined;
}

/** A sablon-mezők kötelezőség-jelölésének két állapota. Lásd `parseTemplateFields`. */
export type TemplateValidation = "api-flag" | "none";

export interface ParsedTemplate {
  fields: ParsedField[];
  allowedLinkedItemTypes: string[];
  /**
   * Volt-e **bármely** mezőn `required` / `mandatory` kulcs a nyers válaszban.
   *
   * Ez nem ugyanaz, mint hogy van-e kötelező mező: ha egyik mező sem hordozza a
   * kulcsot, akkor a `required: false` értékek nem azt jelentik, hogy semmi sem
   * kötelező, hanem hogy **nem tudjuk**. Ilyenkor a saját ellenőrzésünk nem fut
   * (különben minden indítást átengedne, és közben azt sugallná, hogy ellenőrzött).
   */
  requiredMarkerPresent: boolean;
}

/** A `metadata` egy mezőjének nyers alakja jelöl-e egyáltalán kötelezőséget. */
function hasRequiredMarker(info: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(info, "required") ||
    Object.prototype.hasOwnProperty.call(info, "mandatory")
  );
}

/**
 * Turn a startDetails response into a normalized field list the model can read
 * directly. Handles both the array and the object-keyed-by-code shapes the API
 * may return for `metadata`.
 *
 * A kötelezőséget a `required` **vagy** a `mandatory` kulcs adja (a Flex melyiket
 * használja, az a P0-6 nyitott kérdése) — és a hívó megkapja azt is, hogy a
 * válasz egyáltalán hordozott-e ilyen jelölést.
 */
export function parseTemplateFields(startDetails: unknown): ParsedTemplate {
  const result = (startDetails as { result?: Record<string, unknown> } | undefined)?.result ?? {};
  const metadata = (result as { metadata?: unknown }).metadata;

  let requiredMarkerPresent = false;
  const toField = (fallbackCode: string, info: Record<string, unknown>): ParsedField => {
    const type = info.type as string | undefined;
    if (hasRequiredMarker(info)) requiredMarkerPresent = true;
    return {
      code: (info.code as string) ?? fallbackCode,
      name: info.name as string | undefined,
      label: info.label as string | undefined,
      type,
      required: info.required === true || info.mandatory === true,
      default: info.default,
      visibility: info.visibility as string | undefined,
      ...(type === "Option" ? { options: parseOptionParams(info.params) } : {}),
    };
  };

  const fields: ParsedField[] = [];
  if (Array.isArray(metadata)) {
    for (const info of metadata) {
      const code = (info as { code?: string })?.code;
      if (code) fields.push(toField(code, info as Record<string, unknown>));
    }
  } else if (metadata && typeof metadata === "object") {
    for (const [code, info] of Object.entries(metadata as Record<string, unknown>)) {
      fields.push(toField(code, (info ?? {}) as Record<string, unknown>));
    }
  }

  const allowed = (result as { allowedLinkedItemTypes?: unknown }).allowedLinkedItemTypes;
  return {
    fields,
    allowedLinkedItemTypes: Array.isArray(allowed) ? (allowed as string[]) : [],
    requiredMarkerPresent,
  };
}

/** Az a szöveg, amit a `validation: "none"` mellé teszünk, hogy a modell ne higgye ellenőrzöttnek. */
export const NO_REQUIRED_MARKER_NOTE =
  "A sablon mezői nem hordoznak kötelezőség-jelölést; a kötelezőséget a Flex szerver " +
  "ellenőrzi indításkor. A flex_workflow_start ilyenkor nem tud előre hiányzó mezőt jelezni.";

/**
 * A `flex_workflow_get_template_details` válasza. Külön függvény, hogy a
 * `validation` / `note` logikát teszt tudja fogni élő Flex nélkül.
 */
export function describeTemplate(
  templateId: number,
  raw: unknown,
  includeRaw = false,
): Record<string, unknown> {
  const { fields, allowedLinkedItemTypes, requiredMarkerPresent } = parseTemplateFields(raw);
  const validation: TemplateValidation = requiredMarkerPresent ? "api-flag" : "none";

  return {
    templateId,
    fields,
    allowedLinkedItemTypes,
    linkedItemRequired: allowedLinkedItemTypes.length > 0,
    validation,
    ...(validation === "none" ? { note: NO_REQUIRED_MARKER_NOTE } : {}),
    // A `raw` a startDetails teljes válasza — a `fields` ennek a normalizált,
    // közvetlenül használható kivonata, így a kettő együtt megduplázza a
    // payloadot. Alapból ezért kimarad; a `raw: true` a hibakeresésé, amikor a
    // normalizálás elfed valamit.
    ...(includeRaw ? { raw } : {}),
  };
}

/**
 * Best-effort ellenőrzés indítás előtt: a kitöltetlen, **jelölten** kötelező
 * mezőkről ad hibaszöveget. `undefined` = nincs kifogás (vagy mert minden
 * megvan, vagy mert a sablon nem jelöl kötelezőséget — lásd
 * `requiredMarkerPresent`). Az érdemi ellenőrzés a Flex szerveré.
 */
export function missingRequiredMessage(
  templateId: number,
  template: ParsedTemplate,
  provided: Record<string, unknown>,
): string | undefined {
  if (!template.requiredMarkerPresent) return undefined;

  const missing = template.fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = provided[field.code];
      return value === undefined || value === null || value === "";
    });
  if (missing.length === 0) return undefined;

  const details = missing
    .map((field) => {
      const opts = field.options ? ` — lehetséges értékek: ${field.options.join(", ")}` : "";
      const label = field.label || field.name ? ` (${field.label || field.name})` : "";
      return `- ${field.code} [${field.type ?? "Text"}]${label}${opts}`;
    })
    .join("\n");

  return (
    `Hiányzó kötelező metaadat mezők a(z) ${templateId} sablonhoz:\n${details}\n\n` +
    `Add meg ezeket a "metadata" objektumban a code kulccsal. ` +
    `A teljes mezőlistát a flex_workflow_get_template_details adja.`
  );
}

export function registerWorkflowTools(server: McpServer, client: FlexHttp, config: FlexConfig): void {
  server.registerTool(
    "flex_workflow_list_templates",
    {
      title: "Munkafolyamat sablonok listázása",
      description: `Az elindítható munkafolyamat-sablonok listája
(GET /dms/workflow/availableTemplates).

Csak azokat adja, amelyeket a bejelentkezett felhasználó indíthat el.

Visszatérés: sablonok id, code, name és description mezőkkel.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return toolJson(await client.request("GET", "/dms/workflow/availableTemplates"));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_workflow_get_template_details",
    {
      title: "Sablon részletek lekérése",
      description: `Egy sablon metaadat-mezői és indítási adatai
(GET /dms/workflow/startDetails/{templateId}).

Mikor használd: a flex_workflow_start előtt. A "fields" elemek "code" mezője az,
amit a start "metadata" objektumában kell megadni.

A "validation" mondja meg, mennyit érnek a "required" értékek: "api-flag" esetén
az API jelöli a kötelezőséget, "none" esetén nem: a required: false csak annyit
tesz, hogy nem tudjuk, a kötelezőséget egyedül a Flex érvényesíti.`,
      inputSchema: {
        templateId: z.number().int().describe("A sablon azonosítója"),
        includeRaw: z
          .boolean()
          .default(false)
          .describe(
            'Tegye-e bele a startDetails nyers válaszát is a "raw" mezőben. A "fields" ennek ' +
              "a normalizált kivonata, ezért alapból kimarad; csak akkor kérd, ha a " +
              "normalizálás elfed valamit.",
          ),
      },
      outputSchema: templateDetailsOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const raw = await client.request("GET", `/dms/workflow/startDetails/${args.templateId}`);
        return toolJson(describeTemplate(args.templateId, raw, args.includeRaw));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_workflow_start",
    {
      title: "Munkafolyamat indítása",
      description: `Új munkafolyamat-példányt indít egy sablonból (POST /dms/workflow/start).

Mikor használd: előtte hívd meg a flex_workflow_get_template_details-t, és add
meg a "metadata"-ban a sablon összes mezőjét.

A kötelező mezőket a Flex szerver érvényesíti; ez a tool előtte csak best-effort
ellenőrzést végez, jelöletlen sablonnál pedig egyáltalán nem.

A deadline helyi falióra: offsettel megadott érték a FLEX_TIMEZONE zónájára
átszámítva megy be.

Visszatérés: az új folyamat id és referenceNumber mezője.`,
      inputSchema: {
        templateId: z.number().int().describe("A sablon azonosítója (a flex_workflow_list_templates adja)"),
        title: z.string().min(1).describe("A folyamat-példány címe"),
        description: z.string().optional().describe("Leírás"),
        deadline: z
          .string()
          .optional()
          .describe("Határidő; offset nélkül helyi faliórának számít (pl. 2026-08-18T23:59:59)"),
        responsibleUserId: z
          .number()
          .int()
          .describe("A felelős felhasználó ID-ja (a flex_user_get_by_username adja meg)"),
        responsibleOrgId: z
          .number()
          .int()
          .describe(
            "A felelős szervezeti egység ID-ja — kötelező, nincs alapértelmezés; " +
              "a flex_user_get_by_username válaszának orgId mezőjéből",
          ),
        linkedItemType: z
          .string()
          .optional()
          .describe("A kapcsolt elem típusa (alszam/foszam/...), csak ha a sablon kéri"),
        linkedItemId: z
          .number()
          .int()
          .optional()
          .describe("A kapcsolt elem ID-ja (a flex_search_linked_items adja), csak ha a sablon kéri"),
        metadata: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .default({})
          .describe(
            'Metaadatok mezőkód → érték formában, pl. { "nettoOsszeg": "400" }. Add meg a ' +
              "sablon összes mezőjét a get_template_details alapján.",
          ),
        files: z
          .array(
            z.object({
              fileName: z.string().describe("A fájl neve"),
              contentBase64: z.string().describe("A fájl tartalma base64 kódolva"),
            }),
          )
          .optional()
          .describe("Csatolmányok: fájlnév + base64 tartalom"),
      },
      // Destruktív: új, iktatott folyamat-példány jön létre a DMS-ben, amit ez a szerver
      // nem tud visszavonni — az MCP-kliens kérjen rá megerősítést.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        // Best-effort: csak akkor szólunk előre hiányzó mezőről, ha a sablon
        // egyáltalán jelöl kötelezőséget. Az érdemi ellenőrzés a Flex szerveré.
        const startDetails = await client.request("GET", `/dms/workflow/startDetails/${args.templateId}`);
        const template = parseTemplateFields(startDetails);
        const provided = args.metadata as Record<string, unknown>;
        const missing = missingRequiredMessage(args.templateId, template, provided);
        if (missing) return toolError(new Error(missing));

        const body: Record<string, unknown> = {
          templateId: args.templateId,
          title: args.title,
          responsibleUser: { userId: args.responsibleUserId, orgId: args.responsibleOrgId },
          metadata: provided,
          files: (args.files ?? []).map((file) => ({
            attachmentTypeCode: null,
            fileName: file.fileName,
            content: file.contentBase64,
          })),
        };
        if (args.linkedItemType && args.linkedItemId !== undefined) {
          body.linkedItem = { linkedItemType: args.linkedItemType, id: args.linkedItemId };
        }
        if (args.description) body.description = args.description;
        if (args.deadline) body.deadline = formatDateTime(args.deadline, config.timeZone);

        return toolJson(await client.request("POST", "/dms/workflow/start", { body }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_workflow_get_my_tasks",
    {
      title: "Saját munkafolyamat-feladatok",
      description: `A bejelentkezett felhasználóhoz rendelt munkafolyamat-feladatok
(GET /dms/wfTasks/my).

Lapozva ad vissza, alapból 20 elemet. Szűrő nélkül a lista több száz elem is
lehet, ezért az aktuális teendőkhöz add meg a statusFilter: "FA_U" értéket.

Visszatérés: lapozó boríték (total, offset, returned, hasMore, fields, items).`,
      inputSchema: {
        statusFilter: z
          .enum(["", "FA_U", "FA_K", "FA_A", "FA_M"])
          .default("")
          .describe("Állapotszűrő: '' mind, FA_U új, FA_K lezárt, FA_A áthelyezett, FA_M megszüntetett"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Hány elem jöjjön vissza (alapértelmezett 20)"),
        offset: z.number().int().min(0).default(0).describe("Hányadik elemtől (alapértelmezett 0)"),
        fields: z
          .enum(["summary", "full"])
          .default("summary")
          .describe(
            '"summary" a hét ismert mező, "full" a nyers elem — ezen a végponton ma a kettő ' +
              "ugyanazt adja, mert a Flex válasza már eleve összefoglaló alakú.",
          ),
      },
      outputSchema: wfTaskListOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const params = args.statusFilter ? { status: args.statusFilter } : undefined;
        const payload = await client.request("GET", "/dms/wfTasks/my", { params });
        const page = envelope(
          payload,
          { offset: args.offset, limit: args.limit, fields: args.fields },
          summarizeWfTask,
        );
        return toolJson(page ?? payload);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_workflow_get_task_details",
    {
      title: "Munkafolyamat-feladat részletei",
      description: `Egy munkafolyamat-feladat részletes adatai (GET /dms/wfTask/{wfTaskId}).

Mikor használd: lezárás előtt — a válasz "possibleWfTaskResults" mezőjéből kell
a flex_workflow_complete_task wfTaskResult értéke.`,
      inputSchema: {
        wfTaskId: z.number().int().describe("A munkafolyamat-feladat azonosítója"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(await client.request("GET", `/dms/wfTask/${args.wfTaskId}`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_workflow_complete_task",
    {
      title: "Munkafolyamat-feladat lezárása",
      description: `Lezár egy munkafolyamat-feladatot eredménnyel: a folyamat továbblép, és
ez innen nem vonható vissza (POST /dms/wfTask/{wfTaskId}/complete).`,
      inputSchema: {
        wfTaskId: z.number().int().describe("A munkafolyamat-feladat azonosítója"),
        wfTaskResult: z
          .string()
          .min(1)
          .describe('Eredménykód a flex_workflow_get_task_details "possibleWfTaskResults" mezőjéből'),
        comment: z.string().optional().describe("Megjegyzés"),
        metadata: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Frissítendő metaadatok mezőnév → érték formában, ha a sablon megköveteli"),
      },
      // Destruktív: a lezárás továbblépteti a munkafolyamatot, visszavonni nem lehet innen.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        const body: Record<string, unknown> = { wfTaskResult: args.wfTaskResult };
        if (args.comment) body.comment = args.comment;
        if (args.metadata && Object.keys(args.metadata).length > 0) body.metadata = args.metadata;
        return toolJson(await client.request("POST", `/dms/wfTask/${args.wfTaskId}/complete`, { body }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_workflow_get_task_comments",
    {
      title: "Munkafolyamat-feladat megjegyzései",
      description: `Egy munkafolyamat-feladat összes megjegyzése
(GET /dms/comments/wfTask/{wfTaskId}).`,
      inputSchema: {
        wfTaskId: z.number().int().describe("A munkafolyamat-feladat azonosítója"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(await client.request("GET", `/dms/comments/wfTask/${args.wfTaskId}`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_workflow_add_task_comment",
    {
      title: "Megjegyzés munkafolyamat-feladathoz",
      description: `Új megjegyzést fűz egy munkafolyamat-feladathoz
(POST /dms/comments/wfTask/{wfTaskId}).

Visszatérés: a feladat összes megjegyzése, az újjal együtt.`,
      inputSchema: {
        wfTaskId: z.number().int().describe("A munkafolyamat-feladat azonosítója"),
        comment: z.string().min(1).describe("A megjegyzés szövege"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        return toolJson(
          await client.request("POST", `/dms/comments/wfTask/${args.wfTaskId}`, {
            body: { comment: args.comment },
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_workflow_get_task_attachments",
    {
      title: "Feladat csatolmányai",
      description: `Egy munkafolyamat-feladathoz közvetlenül csatolt fájlok
(GET /dms/attachments/wfTask/{wfTaskId}).

Visszatérés: csatolmányok listája; az attachmentGuid-dal tölthető le a fájl a
flex_workflow_download_attachment tool-lal.`,
      inputSchema: {
        wfTaskId: z.number().int().describe("A munkafolyamat-feladat azonosítója"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(await client.request("GET", `/dms/attachments/wfTask/${args.wfTaskId}`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_workflow_get_task_related_attachments",
    {
      title: "Feladathoz kapcsolódó csatolmányok",
      description: `A feladathoz kapcsolódó, de nem közvetlenül csatolt fájlok
(GET /dms/attachments/wfTask/{wfTaskId}/related).`,
      inputSchema: {
        wfTaskId: z.number().int().describe("A munkafolyamat-feladat azonosítója"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(await client.request("GET", `/dms/attachments/wfTask/${args.wfTaskId}/related`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_workflow_download_attachment",
    {
      title: "Csatolmány letöltése",
      description: `Letölt egy csatolmányt GUID alapján és lemezre menti
(GET /dms/attachment/{attachmentGuid}/download).

A fájl mindig a letöltési könyvtárba (FLEX_DOWNLOAD_DIR) vagy annak
alkönyvtárába kerül; az azon kívülre mutató savePath hibát ad.
Meglévő fájlt nem ír felül: ütközésnél a név -1, -2… utótagot kap.`,
      inputSchema: {
        attachmentGuid: z.string().min(1).describe("A csatolmány GUID-ja"),
        savePath: z
          .string()
          .optional()
          .describe(
            'Fájlnév vagy a letöltési könyvtár alatti relatív út, pl. "szamla.pdf" vagy ' +
              '"2026/szamla.pdf". "/"-re végződve könyvtárnak számít, és a szerver által adott ' +
              "fájlnév kerül alá. Üresen a szerver által adott fájlnevet használja. A letöltési " +
              'könyvtár alapértelmezetten az ideiglenes könyvtár "dmsone-flex" almappája.',
          ),
      },
      outputSchema: downloadOutput,
      // Fájlt hoz létre a lemezen → nem read-only; ütközésnél új nevet ad → nem idempotens.
      // Nem destruktív: meglévő fájlt sosem ír felül (`wx` flag).
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const result = await client.download(
          `/dms/attachment/${encodeURIComponent(args.attachmentGuid)}/download`,
        );
        const baseDir = downloadBaseDir(config);
        // A szerver fájlneve és a GUID is nem megbízható bemenet — mindkettő tisztul.
        const safeName = sanitizeFileName(result.fileName, args.attachmentGuid);
        const targetPath = resolveDownloadPath(baseDir, args.savePath, safeName);

        await ensureDirInside(baseDir, targetPath);
        const finalPath = await uniquePath(targetPath);
        // `wx`: csak új fájlt hoz létre; ha közben mégis létrejött, EEXIST hiba — felülírás sosem.
        await fs.writeFile(finalPath, result.data, { flag: "wx" });

        return toolJson({
          success: true,
          filePath: finalPath,
          fileName: basename(finalPath),
          downloadDir: baseDir,
          bytes: result.data.length,
          contentType: result.contentType,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_search_linked_items",
    {
      title: "Kapcsolt elem keresése",
      description: `Kapcsolt elemet (iratot) keres azonosító alapján, pl. "DMS/13/2023"
(GET /dms/id/linkedItem).

Mikor használd: a flex_workflow_start "linkedItemId" mezőjéhez kell ID.

Visszatérés: a talált elem id és identifier mezője.`,
      inputSchema: {
        linkedItemType: z
          .string()
          .min(1)
          .describe(
            "A kapcsolt elem típusa. Ismert értékek: alszam, foszam, dmsszamla, dmsszerz, " +
              "sopver, vvszerz, szamlatar, szamlatar_utalasi_lista.",
          ),
        identifier: z
          .string()
          .min(3, "A kereséshez legalább 3 karakter kell")
          .describe('Keresett azonosító, legalább 3 karakter (pl. "DMS/13/2023")'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(
          await client.request("GET", "/dms/id/linkedItem", {
            params: { linkedItemType: args.linkedItemType, identifier: args.identifier },
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
