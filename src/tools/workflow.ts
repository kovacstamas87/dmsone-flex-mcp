import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { FlexClient } from "../client.js";
import type { FlexConfig } from "../config.js";
import { formatDateTime, toolError, toolJson } from "../format.js";
import { ensureDirInside, resolveDownloadPath, sanitizeFileName, uniquePath } from "../paths.js";
import { envelope, summarizeWfTask } from "../projection.js";

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

export function registerWorkflowTools(
  server: McpServer,
  client: FlexClient,
  config: FlexConfig,
): void {
  server.registerTool(
    "flex_workflow_list_templates",
    {
      title: "Munkafolyamat sablonok listázása",
      description: `Lekéri az összes elindítható munkafolyamat-sablont (GET /dms/workflow/availableTemplates).

Csak azokat adja vissza, amelyeket a bejelentkezett felhasználó elindíthat.
A flex_workflow_start ezekből a sablonokból indít új folyamatot.

Visszatérés: { success, result: [{ id, code, name, description }] }`,
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
      description: `Lekéri egy sablon metaadat mezőit és indítási adatait
(GET /dms/workflow/startDetails/{templateId}).

A flex_workflow_start előtt ezzel nézd meg, milyen mezők tartoznak a sablonhoz.

A válasz "fields" tömbje már normalizált, közvetlenül használható:
  - code: ezt a kulcsot kell használni a start "metadata" objektumában
  - type: a mező típusa (Text, Option, Date, Number, Money, Partner, stb.)
  - required: a mező kötelezősége, AHOGY AZ API JELÖLI — lásd a "validation" mezőt
  - options: Option típusnál a választható értékek listája
  - default: alapértelmezett érték (ha van)

A "validation" mező mondja meg, mennyit érnek a "required" értékek:
  - "api-flag": az API jelöli a kötelezőséget, a required értékek érdemiek
  - "none": a sablon mezői NEM hordoznak kötelezőség-jelölést, így a required: false
    azt jelenti, hogy nem tudjuk — a kötelezőséget csak a Flex szerver érvényesíti
    indításkor. Ilyenkor a válasz "note" mezője is jelzi ezt.

A "linkedItemRequired" jelzi, kell-e kapcsolt elemet (irat) megadni, az
"allowedLinkedItemTypes" pedig a megengedett típusokat.

Bemenet:
  - templateId (number, kötelező): a sablon azonosítója
  - includeRaw (boolean, alapértelmezett false): tegye-e bele a startDetails nyers
    válaszát is. A "fields" ennek a normalizált kivonata, ezért a nyers válasz
    alapból kimarad; csak akkor kérd, ha a normalizálás elfed valamit.

Visszatérés: { templateId, fields: [...], allowedLinkedItemTypes, linkedItemRequired,
validation, note?, raw? }`,
      inputSchema: {
        templateId: z.number().int().describe("A sablon azonosítója"),
        includeRaw: z
          .boolean()
          .default(false)
          .describe("Tegye-e bele a startDetails nyers válaszát is (alapértelmezetten nem)"),
      },
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
      description: `Új munkafolyamat-példányt indít egy sablon alapján (POST /dms/workflow/start).

A sablonhoz tartozó metaadat mezőket meg kell adni. A kötelező mezőket a Flex
szerver érvényesíti; ez a tool előtte egy best-effort ellenőrzést végez: lekéri a
sablon mezőit (startDetails), és ha az API jelöli a kötelezőséget
(validation: "api-flag"), a hiányzó mezőkről előre szól. Ha a sablon nem jelöl
kötelezőséget (validation: "none"), ez az ellenőrzés kimarad, és a hiányzó mezőt
csak a Flex hibaválasza mutatja meg. Ezért előbb hívd meg a
flex_workflow_get_template_details-t, és add meg az összes mezőt, amit a sablon
felsorol.

Bemenet:
  - templateId (number, kötelező): a sablon azonosítója (flex_workflow_list_templates)
  - title (string, kötelező): a folyamat-példány címe
  - description (string): leírás
  - deadline (string): határidő ISO 8601 formátumban
  - responsibleUserId (number, kötelező): a felelős felhasználó ID-ja (flex_user_get_by_username)
  - responsibleOrgId (number): a felelős szervezeti egység ID-ja (alapértelmezett 1)
  - linkedItemType (string): a kapcsolt elem típusa (pl. "alszam"/"foszam") — csak ha a sablon kéri
  - linkedItemId (number): a kapcsolt elem ID-ja (flex_search_linked_items) — csak ha a sablon kéri
  - metadata (objektum): { "mezoKod": "ertek", ... } a sablon mezőkódjaival.
    Add meg legalább az összes required mezőt a get_template_details alapján.
  - files (tömb): [{ fileName, contentBase64 }] csatolmányok

A "deadline" a Flex helyi faliórája szerint értendő: offset nélkül megadott érték
(pl. "2026-08-18T23:59:59") változatlanul megy be, offsettel megadott ("...Z",
"...+02:00") a szerver zónájára (FLEX_TIMEZONE) átszámítva.

Visszatérés: { id, referenceNumber } az új folyamatról`,
      inputSchema: {
        templateId: z.number().int().describe("A sablon azonosítója"),
        title: z.string().min(1).describe("A folyamat-példány címe"),
        description: z.string().optional().describe("Leírás"),
        deadline: z
          .string()
          .optional()
          .describe("Határidő; offset nélkül helyi faliórának számít (pl. 2026-08-18T23:59:59)"),
        responsibleUserId: z.number().int().describe("A felelős felhasználó ID-ja"),
        responsibleOrgId: z.number().int().default(1).describe("A felelős szervezeti egység ID-ja"),
        linkedItemType: z
          .string()
          .optional()
          .describe("A kapcsolt elem típusa (alszam/foszam/...), csak ha a sablon kéri"),
        linkedItemId: z.number().int().optional().describe("A kapcsolt elem ID-ja, csak ha a sablon kéri"),
        metadata: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .default({})
          .describe('Metaadatok mezőkód → érték formában, pl. { "nettoOsszeg": "400" }'),
        files: z
          .array(
            z.object({
              fileName: z.string().describe("A fájl neve"),
              contentBase64: z.string().describe("A fájl tartalma base64 kódolva"),
            }),
          )
          .optional()
          .describe("Csatolmányok"),
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
      description: `Lekéri a bejelentkezett felhasználóhoz rendelt munkafolyamat-feladatokat
(GET /dms/wfTasks/my).

Lapozva ad vissza: alapértelmezés szerint 20 elemet. Szűrő nélkül a lista több
száz elem is lehet (a lezárt és megszüntetett feladatokkal együtt), ezért ha az
aktuális teendők kellenek, add meg a statusFilter: "FA_U" értéket.

Bemenet:
  - statusFilter ("" | "FA_U" | "FA_K" | "FA_A" | "FA_M"): állapotszűrő.
    "" = mind, FA_U = új, FA_K = lezárt, FA_A = áthelyezett, FA_M = megszüntetett.
  - limit (1-100, alapértelmezett 20), offset (alapértelmezett 0): lapozás
  - fields ("summary" | "full", alapértelmezett "summary"). Ezen a végponton a
    két mód ma ugyanazokat a mezőket adja — a lista már eleve összefoglaló alakú.

Visszatérés: { total, offset, returned, hasMore, fields,
items: [{ wfTaskId, wfSubject, wfTaskName, status, type, template, templateVersion }] }`,
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
          .describe('"summary" a hét ismert mező, "full" a nyers elem'),
      },
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
      description: `Lekéri egy munkafolyamat-feladat részletes adatait (GET /dms/wfTask/{wfTaskId}).

A válaszban szerepel a "possibleWfTaskResults" — ezekből az értékekből kell egyet
megadni a flex_workflow_complete_task hívásnál (wfTaskResult).

Bemenet:
  - wfTaskId (number, kötelező): a munkafolyamat-feladat azonosítója

Visszatérés: { success, result: { wfDetails, metadata, possibleWfTaskResults, comments, attachments, ... } }`,
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
      description: `Lezár egy munkafolyamat-feladatot eredménnyel és opcionális megjegyzéssel
(POST /dms/wfTask/{wfTaskId}/complete).

A wfTaskResult a feladat egy érvényes eredménykódja — ezt a
flex_workflow_get_task_details "possibleWfTaskResults" mezőjéből vedd.

Bemenet:
  - wfTaskId (number, kötelező): a feladat azonosítója
  - wfTaskResult (string, kötelező): eredménykód (pl. "0", "1", vagy a sablon által várt érték)
  - comment (string): megjegyzés
  - metadata (objektum): { "mezoNev": "ertek" } frissítendő metaadatok, ha a sablon megköveteli

Visszatérés: { success, result: boolean }`,
      inputSchema: {
        wfTaskId: z.number().int().describe("A munkafolyamat-feladat azonosítója"),
        wfTaskResult: z.string().min(1).describe("A feladat eredménykódja"),
        comment: z.string().optional().describe("Megjegyzés"),
        metadata: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Frissítendő metaadatok mezőnév → érték formában"),
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
      description: `Lekéri egy munkafolyamat-feladat összes megjegyzését
(GET /dms/comments/wfTask/{wfTaskId}).

Bemenet:
  - wfTaskId (number, kötelező): a feladat azonosítója

Visszatérés: { success, result: { wfTaskId, wfDetails, comments: [...] } }`,
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

Bemenet:
  - wfTaskId (number, kötelező): a feladat azonosítója
  - comment (string, kötelező): a megjegyzés szövege

Visszatérés: { success, result: { wfTaskId, wfDetails, comments } } (az összes megjegyzéssel)`,
      inputSchema: {
        wfTaskId: z.number().int().describe("A munkafolyamat-feladat azonosítója"),
        comment: z.string().min(1).describe("A megjegyzés szövege"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
      description: `Lekéri egy munkafolyamat-feladathoz közvetlenül csatolt fájlokat
(GET /dms/attachments/wfTask/{wfTaskId}).

A válaszban szereplő "attachmentGuid" értékkel lehet letölteni egy fájlt a
flex_workflow_download_attachment tool-lal.

Bemenet:
  - wfTaskId (number, kötelező): a feladat azonosítója

Visszatérés: { success, result: [{ name, creator, createDate, version, attachmentGuid, attachmentType }] }`,
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
      description: `Lekéri a munkafolyamat-feladathoz kapcsolódó (nem közvetlenül csatolt) fájlokat
(GET /dms/attachments/wfTask/{wfTaskId}/related).

Bemenet:
  - wfTaskId (number, kötelező): a feladat azonosítója

Visszatérés: { success, result: [{ attachmentId, fileName, relatedDocumentId, relatedDocumentType }] }`,
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
      description: `Letölt egy csatolmányt GUID alapján és a letöltési könyvtárba menti
(GET /dms/attachment/{attachmentGuid}/download).

A fájl MINDIG a letöltési könyvtárba (FLEX_DOWNLOAD_DIR, alapértelmezetten az OS
temp könyvtárának "dmsone-flex" almappája) vagy annak egy alkönyvtárába kerül.
A könyvtáron kívülre mutató savePath (abszolút út, meghajtó-betű, UNC-út, "..")
hibát ad. Meglévő fájlt nem ír felül: ütközésnél a név -1, -2… utótagot kap.
A GUID-ot a flex_workflow_get_task_attachments adja vissza.

Bemenet:
  - attachmentGuid (string, kötelező): a csatolmány GUID-ja
  - savePath (string): fájlnév vagy a letöltési könyvtár alatti relatív út,
    pl. "szamla.pdf" vagy "2026/szamla.pdf". "/"-re végződve könyvtárnak számít,
    és a szerver által adott fájlnév kerül alá. Üresen a szerver által adott
    fájlnevet használja a letöltési könyvtárban.

Visszatérés: { success, filePath (abszolút, a letöltési könyvtár alatt), fileName,
downloadDir, bytes, contentType }`,
      inputSchema: {
        attachmentGuid: z.string().min(1).describe("A csatolmány GUID-ja"),
        savePath: z
          .string()
          .optional()
          .describe("Fájlnév vagy a letöltési könyvtár alatti relatív út (opcionális)"),
      },
      // Fájlt hoz létre a lemezen → nem read-only; ütközésnél új nevet ad → nem idempotens.
      // Nem destruktív: meglévő fájlt sosem ír felül (`wx` flag).
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        const result = await client.download(`/dms/attachment/${encodeURIComponent(args.attachmentGuid)}/download`);
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
      description: `Kapcsolt elemet (iratot) keres azonosító alapján (GET /dms/id/linkedItem).

A flex_workflow_start "linkedItemId" mezőjéhez ad ID-t. Adj meg legalább 3 karaktert.

Bemenet:
  - linkedItemType (string, kötelező): a kapcsolt elem típusa. Ismert értékek:
    "alszam", "foszam", "dmsszamla", "dmsszerz", "sopver", "vvszerz",
    "szamlatar", "szamlatar_utalasi_lista".
  - identifier (string, kötelező, min. 3 karakter): keresett azonosító, pl. "DMS/13/2023"

Visszatérés: { success, result: { id, identifier } }`,
      inputSchema: {
        linkedItemType: z.string().min(1).describe("A kapcsolt elem típusa (alszam, foszam, ...)"),
        identifier: z.string().min(3, "A kereséshez legalább 3 karakter kell").describe("Keresett azonosító"),
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
