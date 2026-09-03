import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { FlexHttp } from "../client.js";
import { formatError, toolError, toolJson } from "../format.js";
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

/**
 * Induláskori, opt-in ellenőrzés (`FLEX_CHECK_ON_START`, P2-5): egyetlen
 * `GET /diag` hívás, hogy egy lejárt vagy érvénytelen token ne csak az első
 * valódi tool-hívásnál derüljön ki, hanem már a szerver indulásakor, stderr-en.
 *
 * Szándékosan **nem lép ki és nem dob** — egy átmeneti hálózati hiba vagy a
 * Flex pillanatnyi elérhetetlensége nem ok arra, hogy egy egyébként érvényes
 * tokennel se induljon el a szerver; a tényleges hívások a saját hibaágukon
 * úgyis jelentkeznek. A `formatError` ugyanazt a magyar, HTTP-státusz szerinti
 * üzenetet adja, amit egy sikertelen tool-hívás is kapna (401/403 → „érvénytelen
 * vagy lejárt token").
 */
export async function checkTokenOnStart(client: FlexHttp): Promise<void> {
  try {
    await client.request("GET", "/diag");
  } catch (error) {
    console.error(
      `FIGYELEM: az induláskori kapcsolat-ellenőrzés (FLEX_CHECK_ON_START) hibát adott — ` +
        `a szerver elindul, de a Flex-hívások valószínűleg hibázni fognak. ${formatError(error)}`,
    );
  }
}

/** Diagnostic / connectivity check against the Flex API. */
export function registerDiagnosticTools(server: McpServer, client: FlexHttp): void {
  server.registerTool(
    "flex_diag",
    {
      title: "Kapcsolat ellenőrzése",
      description: `Diagnosztikai hívás a Flex API felé (GET /diag): a kapcsolatot és a
token érvényességét ellenőrzi. A szerver fejléceit és környezeti változóit nem adja vissza.`,
      inputSchema: z.object({
        greeting: z.string().optional().describe("Opcionális üdvözlő szöveg, amit a szerver visszatükröz"),
      }),
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
