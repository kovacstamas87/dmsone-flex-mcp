import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import type { FlexClient } from "../client.js";
import type { FlexConfig } from "../config.js";
import { formatDateTime, toolError, toolJson } from "../format.js";

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

/**
 * Turn a startDetails response into a normalized field list the model can read
 * directly. Handles both the array and the object-keyed-by-code shapes the API
 * may return for `metadata`.
 */
export function parseTemplateFields(startDetails: unknown): {
  fields: ParsedField[];
  allowedLinkedItemTypes: string[];
} {
  const result = (startDetails as { result?: Record<string, unknown> } | undefined)?.result ?? {};
  const metadata = (result as { metadata?: unknown }).metadata;

  const toField = (fallbackCode: string, info: Record<string, unknown>): ParsedField => {
    const type = info.type as string | undefined;
    return {
      code: (info.code as string) ?? fallbackCode,
      name: info.name as string | undefined,
      label: info.label as string | undefined,
      type,
      required: info.required === true,
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
  };
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
      description: `Lekéri egy sablon kötelező metaadat mezőit és indítási adatait
(GET /dms/workflow/startDetails/{templateId}).

A flex_workflow_start előtt MINDIG ezzel derítsd ki, milyen mezőket kell kitölteni.

A válasz "fields" tömbje már normalizált, közvetlenül használható:
  - code: ezt a kulcsot kell használni a start "metadata" objektumában
  - type: a mező típusa (Text, Option, Date, Number, Money, Partner, stb.)
  - required: true esetén kötelező kitölteni
  - options: Option típusnál a választható értékek listája
  - default: alapértelmezett érték (ha van)
A "linkedItemRequired" jelzi, kell-e kapcsolt elemet (irat) megadni, az
"allowedLinkedItemTypes" pedig a megengedett típusokat.

Bemenet:
  - templateId (number, kötelező): a sablon azonosítója

Visszatérés: { templateId, fields: [...], allowedLinkedItemTypes, linkedItemRequired, raw }`,
      inputSchema: {
        templateId: z.number().int().describe("A sablon azonosítója"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const raw = await client.request("GET", `/dms/workflow/startDetails/${args.templateId}`);
        const { fields, allowedLinkedItemTypes } = parseTemplateFields(raw);
        return toolJson({
          templateId: args.templateId,
          fields,
          allowedLinkedItemTypes,
          linkedItemRequired: allowedLinkedItemTypes.length > 0,
          raw,
        });
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

FONTOS: minden, a sablonhoz tartozó metaadat mezőt meg kell adni. A szerver és ez a
tool is ellenőrzi: előbb lekéri a sablon mezőit (startDetails), és hibát ad, ha
hiányzik valamelyik. Ezért előbb hívd meg a flex_workflow_get_template_details-t.

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

Visszatérés: { id, referenceNumber } az új folyamatról`,
      inputSchema: {
        templateId: z.number().int().describe("A sablon azonosítója"),
        title: z.string().min(1).describe("A folyamat-példány címe"),
        description: z.string().optional().describe("Leírás"),
        deadline: z.string().optional().describe("Határidő ISO 8601 formátumban"),
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        // Discover the template's fields and validate the genuinely required ones.
        const startDetails = await client.request("GET", `/dms/workflow/startDetails/${args.templateId}`);
        const { fields } = parseTemplateFields(startDetails);
        const provided = args.metadata as Record<string, unknown>;
        const requiredFields = fields.filter((field) => field.required);
        const missing = requiredFields.filter((field) => {
          const value = provided[field.code];
          return value === undefined || value === null || value === "";
        });
        if (missing.length > 0) {
          const details = missing
            .map((field) => {
              const opts = field.options ? ` — lehetséges értékek: ${field.options.join(", ")}` : "";
              const label = field.label || field.name ? ` (${field.label || field.name})` : "";
              return `- ${field.code} [${field.type ?? "Text"}]${label}${opts}`;
            })
            .join("\n");
          return toolError(
            new Error(
              `Hiányzó kötelező metaadat mezők a(z) ${args.templateId} sablonhoz:\n${details}\n\n` +
                `Add meg ezeket a "metadata" objektumban a code kulccsal. ` +
                `A teljes mezőlistát a flex_workflow_get_template_details adja.`,
            ),
          );
        }

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
        if (args.deadline) body.deadline = formatDateTime(args.deadline);

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

Bemenet:
  - statusFilter ("" | "FA_U" | "FA_K" | "FA_A" | "FA_M"): állapotszűrő.
    "" = mind, FA_U = új, FA_K = lezárt, FA_A = áthelyezett, FA_M = megszüntetett.

Visszatérés: { success, result: [{ wfTaskId, wfSubject, wfTaskName, status, type, template, templateVersion }] }`,
      inputSchema: {
        statusFilter: z
          .enum(["", "FA_U", "FA_K", "FA_A", "FA_M"])
          .default("")
          .describe("Állapotszűrő: '' mind, FA_U új, FA_K lezárt, FA_A áthelyezett, FA_M megszüntetett"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const params = args.statusFilter ? { status: args.statusFilter } : undefined;
        return toolJson(await client.request("GET", "/dms/wfTasks/my", { params }));
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
      description: `Letölt egy csatolmányt GUID alapján és a helyi lemezre menti
(GET /dms/attachment/{attachmentGuid}/download).

Mivel ez egy lokális szerver, a bináris tartalmat fájlba menti, és a fájl elérési
útját adja vissza. A GUID-ot a flex_workflow_get_task_attachments adja vissza.

Bemenet:
  - attachmentGuid (string, kötelező): a csatolmány GUID-ja
  - savePath (string): hova mentse a fájlt. Lehet teljes útvonal vagy fájlnév
    (ez utóbbi a letöltési könyvtárba kerül). Üresen a szerver által adott
    fájlnevet használja a letöltési könyvtárban.

Visszatérés: { success, filePath, fileName, bytes, contentType }`,
      inputSchema: {
        attachmentGuid: z.string().min(1).describe("A csatolmány GUID-ja"),
        savePath: z.string().optional().describe("Cél útvonal vagy fájlnév (opcionális)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const result = await client.download(`/dms/attachment/${encodeURIComponent(args.attachmentGuid)}/download`);
        const baseDir = config.downloadDir || tmpdir();
        const fallbackName = result.fileName || `${args.attachmentGuid}`;

        let targetPath: string;
        if (args.savePath && isAbsolute(args.savePath)) {
          targetPath = args.savePath;
        } else if (args.savePath) {
          targetPath = join(baseDir, args.savePath);
        } else {
          targetPath = join(baseDir, fallbackName);
        }

        await fs.writeFile(targetPath, result.data);
        return toolJson({
          success: true,
          filePath: targetPath,
          fileName: result.fileName ?? fallbackName,
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
