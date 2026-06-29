import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlexClient } from "../client.js";
import { toolError, toolJson } from "../format.js";

/** Diagnostic / connectivity check against the Flex API. */
export function registerDiagnosticTools(server: McpServer, client: FlexClient): void {
  server.registerTool(
    "flex_diag",
    {
      title: "Kapcsolat ellenőrzése",
      description: `Diagnosztikai hívás a Flex API felé (GET /diag). A kapcsolat és a
hitelesítés ellenőrzésére használható.

Bemenet:
  - greeting (string): opcionális üdvözlő szöveg, amit a szerver visszatükröz

Visszatérés: a Flex /diag végpont válasza (method, uri, qs)`,
      inputSchema: {
        greeting: z.string().optional().describe("Opcionális üdvözlő szöveg"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const params = args.greeting ? { greeting: args.greeting } : undefined;
        return toolJson(await client.request("GET", "/diag", { params }));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
