import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { FlexHttp } from "../client.js";
import { toolError, toolJson } from "../format.js";

/** User resource — resolve Flex users by (partial) username. */
export function registerUserTools(server: McpServer, client: FlexHttp): void {
  server.registerTool(
    "flex_user_get_by_username",
    {
      title: "Felhasználó keresése név alapján",
      description: `Felhasználó keresése megjelenített név (töredéke) alapján (GET /dms/ac/user).
Ékezet-érzékeny: "ková" talál, "kovacs" nem.

Visszatérés: userId és userName. orgId-t NEM ad — az a flex_task_list elemein és
a wfTask részletein (wfDetails.responsibleUser.orgId) van.`,
      inputSchema: z.object({
        username: z
          .string()
          .min(2, "A kereséshez legalább 2 karakter kell")
          .describe("A keresett felhasználó megjelenített neve vagy annak töredéke, ékezetesen"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(await client.request("GET", "/dms/ac/user", { params: { username: args.username } }));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
