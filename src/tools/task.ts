import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { FlexHttp } from "../client.js";
import type { FlexConfig } from "../config.js";
import { formatDateTime, toolError, toolJson } from "../format.js";
import { envelope, summarizeTask } from "../projection.js";
import { taskListOutput } from "../schema.js";
import { withUntrusted } from "../untrusted.js";

/**
 * Task resource — simple DMS tasks (not full workflow processes).
 * Endpoints: /dms/task/start, /dms/comments/task/{id}, /dms/task/{id}/accept,
 * /dms/task/{id}/complete, /dms/news.
 */
export function registerTaskTools(server: McpServer, client: FlexHttp, config: FlexConfig): void {
  server.registerTool(
    "flex_task_create",
    {
      title: "Feladat létrehozása",
      description: `Új DMS feladatot oszt ki (POST /dms/task/start).

Mikor használd: egyszerű, kézzel kiosztott teendőhöz; teljes munkafolyamathoz a
flex_workflow_start való.

Dátumok: a Flex helyi faliórát tárol — offsettel megadott érték a FLEX_TIMEZONE
zónájára átszámítva megy be.

Visszatérés: az új feladat id és referenceNumber mezője.`,
      inputSchema: z.object({
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
        performerUserId: z
          .number()
          .int()
          .optional()
          .describe("A végrehajtó felhasználó ID-ja (a flex_user_get_by_username adja meg)"),
        performerOrgId: z
          .number()
          .int()
          .optional()
          .describe(
            "A végrehajtó szervezeti egység ID-ja — performerUserId megadása esetén kötelező, " +
              "nincs alapértelmezés; forrása a flex_user_get_by_username leírásában",
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        if (args.performerUserId !== undefined && args.performerOrgId === undefined) {
          return toolError(
            new Error(
              "performerOrgId kötelező, ha performerUserId meg van adva (nincs alapértelmezett szervezeti egység)",
            ),
          );
        }
        const users =
          args.performerUserId !== undefined
            ? [{ userId: args.performerUserId, orgId: args.performerOrgId! }]
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
      description: `Megjegyzést fűz egy meglévő feladathoz (POST /dms/comments/task/{taskId}).`,
      inputSchema: z.object({
        taskId: z.string().min(1).describe("A feladat azonosítója"),
        comment: z.string().min(1).describe("A megjegyzés szövege"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        // A válasz a megjegyzéseket adja vissza — más felhasználók szövegét is.
        return toolJson(
          withUntrusted(
            await client.request("POST", `/dms/comments/task/${encodeURIComponent(args.taskId)}`, {
              body: { comment: args.comment },
            }),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // A két művelet csak a `destructiveHint`-ben tér el: az elfogadás visszafordítható
  // állapotváltás, a lezárás viszont befejezi a feladatot, amit innen nem lehet visszavonni.
  const acceptComplete = (
    operation: "accept" | "complete",
    title: string,
    summary: string,
    destructive: boolean,
  ) =>
    server.registerTool(
      `flex_task_${operation}`,
      {
        title,
        description: `${summary} (POST /dms/task/{taskId}/${operation}).`,
        inputSchema: z.object({
          taskId: z.string().min(1).describe("A feladat azonosítója"),
          comment: z.string().optional().describe("Opcionális megjegyzés a művelethez"),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: destructive,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args) => {
        try {
          const body = args.comment ? { comment: args.comment } : {};
          return toolJson(
            await client.request("POST", `/dms/task/${encodeURIComponent(args.taskId)}/${operation}`, {
              body,
            }),
          );
        } catch (error) {
          return toolError(error);
        }
      },
    );

  acceptComplete("accept", "Feladat elfogadása", "Elfogad egy feladatot: a végrehajtó elvállalja", false);
  acceptComplete("complete", "Feladat lezárása", "Lezár egy feladatot; innen nem vonható vissza", true);

  server.registerTool(
    "flex_task_list",
    {
      title: "Feladatok listázása",
      description: `A bejelentkezett felhasználó feladatai (GET /dms/news). Vegyes lista: a
"type" választja el a Task és a WfTask elemeket; az "idKind" ("taskId" vagy
"wfTaskId") mondja meg, melyik eszközcsalád (flex_task_* / flex_workflow_*) kezeli.

Alapból lapozott összefoglaló, 20 elem — a leírás, a metaadatok és a
megjegyzések szövege NEM szerepel benne, azokhoz a
flex_workflow_get_task_details / _comments / _attachments való.

Flex-hiba: a status "all" HTTP 500-at ad; a "pending" és a "completed" ugyanazt
a listát adja.

Visszatérés: lapozó boríték (total, offset, returned, hasMore, fields, items).`,
      inputSchema: z.object({
        status: z
          .enum(["in-progress", "completed", "pending", "all"])
          .default("in-progress")
          .describe('Állapotszűrő; az "all" nem küld szűrőt — a Flex jelenleg 500-at ad rá'),
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
      }),
      outputSchema: taskListOutput,
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
        // A `subject` (és `full` módban a leírás, a megjegyzések) felhasználói szöveg.
        return toolJson(withUntrusted(page ?? payload));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
