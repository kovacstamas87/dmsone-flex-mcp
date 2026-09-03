import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlexClient } from "../client.js";
import { toolError, toolJson } from "../format.js";

/** User resource — resolve Flex users by (partial) username. */
export function registerUserTools(server: McpServer, client: FlexClient): void {
  server.registerTool(
    "flex_user_get_by_username",
    {
      title: "Felhasználó keresése név alapján",
      description: `Felhasználó keresése felhasználónév (töredék) alapján (GET /dms/ac/user).

Mikor használd: ha egy művelethez userId + orgId kell — feladat végrehajtójához
vagy munkafolyamat felelőséhez.

Visszatérés: találatok userId, orgId, userName és orgName mezőkkel.`,
      inputSchema: {
        username: z
          .string()
          .min(2, "A kereséshez legalább 2 karakter kell")
          .describe("Keresett felhasználónév vagy töredéke"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(
          await client.request("GET", "/dms/ac/user", { params: { username: args.username } }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
