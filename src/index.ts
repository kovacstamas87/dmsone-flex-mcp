#!/usr/bin/env node
/**
 * DMS One Flex MCP Server.
 *
 * A local (stdio) MCP server exposing the DMS One Flex REST API to Claude Desktop
 * and any other MCP-compatible client. It wraps the same endpoints as the
 * n8n-nodes-dmsone-flex community node.
 *
 * Configuration is read from environment variables (see .env.example). Each user
 * runs the server locally with their own FLEX_TOKEN.
 */
import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig, validateConfig } from "./config.js";
import { FlexClient } from "./client.js";
import { registerTaskTools } from "./tools/task.js";
import { registerUserTools } from "./tools/user.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerDiagnosticTools } from "./tools/diagnostic.js";
import { registerSecretValue } from "./redact.js";

/**
 * Server-level guidance surfaced to the model by the MCP client. This is the
 * "map" that tells the assistant what this server is for, the domain vocabulary,
 * and which tool answers which kind of question.
 */
const SERVER_INSTRUCTIONS = `A DMS One Flex egy vállalati dokumentum- és munkafolyamat-kezelő rendszer
(DMS One Ultimate) REST API-ja. Ez a szerver feladatok, munkafolyamatok és
felhasználók kezelését teszi lehetővé. Minden hívás a beállított token
tulajdonosának (vagy station tokennél az impersonált felhasználónak) a
nevében és jogosultságaival fut.

FONTOS — két külön "feladat" fogalom van, ne keverd őket:
- Task (egyszerű DMS feladat): flex_task_* tool-ok, /dms/task és /dms/news végpontok.
  Kézzel kiosztott teendő, taskId azonosítóval.
- WfTask (munkafolyamat-feladat): flex_workflow_* tool-ok, /dms/wfTask végpontok.
  Egy futó munkafolyamat-példány egy lépése, wfTaskId azonosítóval.
Ha a felhasználó nem pontosít, kérdezz rá, vagy nézd meg mindkettőt
(flex_task_list és flex_workflow_get_my_tasks). A flex_task_list a /dms/news
vegyes válaszát adja: elemenként az "idKind" mondja meg, melyik eszközcsalád
kezeli — "taskId" a flex_task_*-ot, "wfTaskId" a flex_workflow_*-ot.

Melyik kérdéshez melyik tool:
- "Milyen feladataim / teendőim vannak?" -> flex_task_list (status: in-progress)
  és/vagy flex_workflow_get_my_tasks.
- Konkrét irat/ügy azonosító alapján (pl. "DMS/13/2023") -> flex_search_linked_items.
- Egy felhasználó adatai / userId kell -> flex_user_get_by_username.
- Új munkafolyamat indítása -> előbb flex_workflow_list_templates, majd
  flex_workflow_get_template_details (kötelező mezők!), végül flex_workflow_start.
- Munkafolyamat-feladat lezárása -> flex_workflow_get_task_details (innen a
  possibleWfTaskResults), majd flex_workflow_complete_task.
- Csatolmány -> flex_workflow_get_task_attachments (GUID), majd
  flex_workflow_download_attachment.
- Kapcsolat tesztelése / token érvényesség -> flex_diag.

Fogalmak:
- alszám / főszám: a kapcsolt elem (irat) típusai (linkedItemType: "alszam" / "foszam").
- referenceNumber / iktatószám: emberi azonosító, pl. "DMS/13/2023".
- userId + orgId: egy felhasználót MINDIG ez a két érték azonosít együtt.
- WfTask státuszok: FA_U (új), FA_K (lezárt), FA_A (áthelyezett), FA_M (megszüntetett).

KORLÁT: ez az API-felület nem támogat általános, teljes szövegű
dokumentum-keresést. Navigálni csak ismert azonosítóból, saját feladatokból
vagy felhasználónévből lehet. Ha a kért adat csak teljes szövegű kereséssel
lenne elérhető, jelezd ezt a felhasználónak, ne találgass azonosítókat.`;

const require = createRequire(import.meta.url);
// A csomag gyökerén álló package.json-ból olvasunk, hogy dist/ és a .mcpb
// (build/pkg/dist) build alól is ugyanazt az egy forrást találja.
const { version: SERVER_VERSION } = require("../package.json") as { version: string };

async function main(): Promise<void> {
  const config = loadConfig();

  const { errors, warnings } = validateConfig(config);
  for (const warning of warnings) console.error(warning);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }

  // A konfigurált token literálisan is bejelentve: ha a Flex bármelyik válaszban
  // visszatükrözi (a /diag ezt teszi), akkor is kiesik, ha a formátuma egyik
  // redakciós mintára sem illik. Lásd src/redact.ts.
  registerSecretValue(config.token);

  const client = new FlexClient(config);
  const server = new McpServer(
    { name: "dmsone-flex-mcp-server", version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerTaskTools(server, client, config);
  registerUserTools(server, client);
  registerWorkflowTools(server, client, config);
  registerDiagnosticTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `DMS One Flex MCP szerver fut (stdio). Base URL: ${config.baseUrl}, ` +
      `auth: ${config.authMethod}${config.impersonatedEmail ? ` (impersonate: ${config.impersonatedEmail})` : ""}.`,
  );
}

main().catch((error) => {
  console.error("Végzetes hiba a szerver indításakor:", error);
  process.exit(1);
});
