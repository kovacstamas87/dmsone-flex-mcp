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
      description: `Felhasználó(ka)t keres felhasználónév alapján (GET /dms/ac/user).

Hasznos, ha egy művelethez userId / orgId kell (pl. feladat végrehajtó vagy
munkafolyamat felelős megadásához). Részleges egyezést is talál.

Bemenet:
  - username (string, kötelező, min. 2 karakter): keresett felhasználónév vagy töredéke

Visszatérés: { success, result: [{ userId, orgId, userName, orgName }] }`,
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
