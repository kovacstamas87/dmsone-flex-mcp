import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlexClient } from "../client.js";
import type { FlexConfig } from "../config.js";
import { formatDateTime, toolError, toolJson } from "../format.js";
import { envelope, summarizeTask } from "../projection.js";

/**
 * Task resource — simple DMS tasks (not full workflow processes).
 * Endpoints: /dms/task/start, /dms/comments/task/{id}, /dms/task/{id}/accept,
 * /dms/task/{id}/complete, /dms/news.
 */
export function registerTaskTools(server: McpServer, client: FlexClient, config: FlexConfig): void {
  server.registerTool(
    "flex_task_create",
    {
      title: "Feladat létrehozása",
      description: `Új DMS feladatot hoz létre a Flex rendszerben (POST /dms/task/start).

Mikor használd: amikor egy egyszerű feladatot kell kiosztani egy felhasználónak (nem teljes munkafolyamatot — arra a flex_workflow_start való).

Bemenet:
  - taskTitle (string, kötelező): a feladat címe
  - taskDescription (string): leírás
  - taskPartner (string): partner megnevezése, üresen null lesz
  - taskPriority (number): prioritás (alapértelmezett 2)
  - taskScheduledStart (string): tervezett kezdés (lásd a dátumokról szóló megjegyzést)
  - taskDeadline (string): határidő (lásd a dátumokról szóló megjegyzést)
  - needsApprovalFromCreator (boolean): kell-e a létrehozó jóváhagyása
  - executorType ("4_elso_elfogado" | "4_mindenki"): ki hajthatja végre
  - performerUserId (number): a végrehajtó felhasználó ID-ja (flex_user_get_by_username adja vissza)
  - performerOrgId (number): a végrehajtó szervezeti egység ID-ja

Dátumok: a Flex helyi faliórát tárol. Offset nélkül megadott érték (pl.
"2026-08-18T23:59:59" vagy "2026-08-18") változatlanul, faliórának számít;
offsettel megadott érték (pl. "...Z" vagy "...+02:00") a szerver zónájára
(FLEX_TIMEZONE, alapértelmezés Europe/Budapest) átszámítva megy be.

Visszatérés: { success, result: { id, referenceNumber } }`,
      inputSchema: {
        taskTitle: z.string().min(1).describe("A feladat címe (kötelező)"),
        taskDescription: z.string().optional().describe("A feladat leírása"),
        taskPartner: z.string().optional().describe("Partner; üresen null értéket küld"),
        taskPriority: z.number().int().default(2).describe("Prioritás (alapértelmezett 2)"),
        taskScheduledStart: z
          .string()
          .optional()
          .describe("Tervezett kezdés; offset nélkül helyi faliórának számít (pl. 2026-08-18T09:00:00)"),
        taskDeadline: z
          .string()
          .optional()
          .describe("Határidő; offset nélkül helyi faliórának számít (pl. 2026-08-18T23:59:59)"),
        needsApprovalFromCreator: z.boolean().default(false).describe("Kell-e a létrehozó jóváhagyása"),
        executorType: z
          .enum(["4_elso_elfogado", "4_mindenki"])
          .default("4_elso_elfogado")
          .describe("Végrehajtó típusa: első elfogadó vagy mindenki"),
        performerUserId: z.number().int().optional().describe("Végrehajtó felhasználó ID-ja"),
        performerOrgId: z.number().int().optional().describe("Végrehajtó szervezeti egység ID-ja"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        const users =
          args.performerUserId !== undefined
            ? [{ userId: args.performerUserId, orgId: args.performerOrgId ?? 1 }]
            : [];
        const body = {
          taskTitle: args.taskTitle,
          taskDescription: args.taskDescription ?? "",
          taskPartner: args.taskPartner || null,
          taskPriority: args.taskPriority,
          taskScheduledStart: formatDateTime(args.taskScheduledStart, config.timeZone),
          taskDeadline: formatDateTime(args.taskDeadline, config.timeZone),
          needsApprovalFromCreator: args.needsApprovalFromCreator,
          executorType: args.executorType,
          files: [],
          taskPerformers: { users },
          relatedDocIds: [],
          relatedFolderIds: [],
        };
        return toolJson(await client.request("POST", "/dms/task/start", { body }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "flex_task_comment",
    {
      title: "Megjegyzés feladathoz",
      description: `Megjegyzést fűz egy meglévő feladathoz (POST /dms/comments/task/{taskId}).

Bemenet:
  - taskId (string, kötelező): a feladat azonosítója
  - comment (string, kötelező): a megjegyzés szövege

Visszatérés: { success, result }`,
      inputSchema: {
        taskId: z.string().min(1).describe("A feladat azonosítója"),
        comment: z.string().min(1).describe("A megjegyzés szövege"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(
          await client.request("POST", `/dms/comments/task/${encodeURIComponent(args.taskId)}`, {
            body: { comment: args.comment },
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // A két művelet csak a `destructiveHint`-ben tér el: az elfogadás visszafordítható
  // állapotváltás, a lezárás viszont befejezi a feladatot, amit innen nem lehet visszavonni.
  const acceptComplete = (operation: "accept" | "complete", title: string, verb: string, destructive: boolean) =>
    server.registerTool(
      `flex_task_${operation}`,
      {
        title,
        description: `${verb} egy feladatot (POST /dms/task/{taskId}/${operation}).

Bemenet:
  - taskId (string, kötelező): a feladat azonosítója
  - comment (string): opcionális megjegyzés

Visszatérés: { success, result: boolean }`,
        inputSchema: {
          taskId: z.string().min(1).describe("A feladat azonosítója"),
          comment: z.string().optional().describe("Opcionális megjegyzés"),
        },
        annotations: { readOnlyHint: false, destructiveHint: destructive, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        try {
          const body = args.comment ? { comment: args.comment } : {};
          return toolJson(
            await client.request("POST", `/dms/task/${encodeURIComponent(args.taskId)}/${operation}`, { body }),
          );
        } catch (error) {
          return toolError(error);
        }
      },
    );

  acceptComplete("accept", "Feladat elfogadása", "Elfogad", false);
  acceptComplete("complete", "Feladat lezárása", "Lezár", true);

  server.registerTool(
    "flex_task_list",
    {
      title: "Feladatok listázása",
      description: `Listázza a bejelentkezett felhasználó feladatait állapot szerint (GET /dms/news).

A lista vegyesen tartalmaz egyszerű Task és munkafolyamat-feladat (WfTask)
elemeket — a "type" mező ("Task" / "WfTask") különíti el őket.

Alapértelmezésben összefoglalót ad, lapozva: 20 elem, elemenként az azonosító,
a tárgy, az állapot, a határidő, a sablon és a megjegyzések/csatolmányok darabszáma.
A leírás, a metaadatok, a megjegyzések és a csatolmányok szövege NEM szerepel benne
— azokhoz a flex_workflow_get_task_details / _comments / _attachments való.
A fields: "full" a nyers elemeket adja: csak kis limittel (1-2 elem) használd,
mert egyetlen elem is több ezer karakter lehet.

Bemenet:
  - status ("in-progress" | "completed" | "pending" | "all"): szűrő (alapértelmezett "in-progress").
    Az "all" esetén nem küld status szűrőt — FIGYELEM: a Flex jelenleg erre HTTP 500-at ad
    (szerveroldali hiba, bejelentve). Amíg nem javítják, a három konkrét értéket használd.
    A "pending" és a "completed" a mérés szerint ugyanazt a listát adja vissza.
  - limit (1-100, alapértelmezett 20), offset (alapértelmezett 0): lapozás
  - fields ("summary" | "full", alapértelmezett "summary")

Visszatérés: { total, offset, returned, hasMore, fields, items }`,
      inputSchema: {
        status: z
          .enum(["in-progress", "completed", "pending", "all"])
          .default("in-progress")
          .describe("Feladatok szűrése állapot szerint"),
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
          .describe('"summary" a lapos összefoglaló, "full" a nyers elem — a "full" csak 1-2 elemre'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const params = args.status !== "all" ? { status: args.status } : undefined;
        const payload = await client.request("GET", "/dms/news", { params });
        const page = envelope(
          payload,
          { offset: args.offset, limit: args.limit, fields: args.fields },
          summarizeTask,
        );
        // Váratlan válaszalak esetén a nyers payload megy tovább — lásd `envelope`.
        return toolJson(page ?? payload);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
