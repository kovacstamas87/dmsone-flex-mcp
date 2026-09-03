import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlexHttp } from "../client.js";
import { toolError, toolJson } from "../format.js";
import { diagOutput } from "../schema.js";

/**
 * A `/diag` válaszából csak az ártalmatlan mezőket tartja meg.
 *
 * Miért: a Flex `/diag` visszatükrözi a kérés fejléceit (`req`, `cookies` — köztük
 * az `Authorization: Bearer …`-rel) és a backend környezeti változóit (`server`,
 * benne `APP_KEY`-jel). A `redactSecrets` ezeket ugyan kicserélné, de a
 * diagnosztikának egyikre sincs szüksége, ezért **fel sem vesszük** a válaszba —
 * a redakció csak a második védvonal.
 *
 * A `method` / `uri` / `qs` a válasz gyökeréből és a `result` burkolóból is
 * elfogadott, mert a Flex mindkét alakot adhatja. Ha egyik sem található,
 * a `{ ok: true }` önmagában is elég válasz: a kapcsolat és a token rendben van
 * (a hibás token 401-et adna, ami a hibaágra megy).
 */
export function pickDiagFields(raw: unknown): Record<string, unknown> {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const nested = root.result;
  const result = nested && typeof nested === "object" ? (nested as Record<string, unknown>) : {};

  const out: Record<string, unknown> = { ok: true };
  for (const key of ["method", "uri", "qs"] as const) {
    const value = result[key] !== undefined ? result[key] : root[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Diagnostic / connectivity check against the Flex API. */
export function registerDiagnosticTools(server: McpServer, client: FlexHttp): void {
  server.registerTool(
    "flex_diag",
    {
      title: "Kapcsolat ellenőrzése",
      description: `Diagnosztikai hívás a Flex API felé (GET /diag): a kapcsolatot és a
token érvényességét ellenőrzi. A szerver fejléceit és környezeti változóit nem adja vissza.`,
      inputSchema: {
        greeting: z.string().optional().describe("Opcionális üdvözlő szöveg, amit a szerver visszatükröz"),
      },
      outputSchema: diagOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const params = args.greeting ? { greeting: args.greeting } : undefined;
        return toolJson(pickDiagFields(await client.request("GET", "/diag", { params })));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
