#!/usr/bin/env node
/**
 * A `manifest.json` szinkronizálása a kóddal. Idempotens: kétszer futtatva
 * ugyanazt az eredményt adja, és csak akkor ír fájlt, ha van mit változtatni.
 *
 * Két dolgot tart egy forráson:
 *   1. **verzió** ← `package.json` (`npm version` hookja hívja);
 *   2. **`tools[]`** ← a **lefordított szerver** `tools/list` válasza.
 *
 * Miért a lefordított `dist/index.js`-ből, és nem a forrásból: pontosan azt a
 * szervert kérdezzük meg, ami a csomagba (`.mcpb`) kerül — így a manifest nem
 * ígérhet olyan eszközt, amit a csomagolt szerver nem regisztrál. Korábban a
 * `tools` tömb kézzel duplikálta a kód leírásait, szinkron-őr nélkül.
 *
 * Ha a `dist/` még nincs meg (pl. `npm version` friss klónon), a `tools` tömböt
 * **változatlanul** hagyjuk, és figyelmeztetünk. Ez tudatos: rosszabb üres
 * tool-listát írni a manifestbe, mint a korábbi állapotot meghagyni.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(rootDir, "package.json");
const manifestPath = join(rootDir, "manifest.json");
const distEntry = join(rootDir, "dist", "index.js");

/**
 * A magyar rövidítések pontja nem mondatvég. Enélkül a
 * `flex_search_linked_items` leírása a „…, pl." szónál vágódna el.
 */
const ABBREVIATIONS = new Set(["pl", "ill", "stb", "kb", "vö", "ún"]);

/**
 * A manifest tool-leírása a tool-leírás **első mondata**: a `tools/list` a
 * modellé, a manifest a Claude Desktop felületén megjelenő lista.
 */
function firstSentence(description) {
  const paragraph = (description ?? "").split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  const boundary = /\.(?=\s|$)/g;
  let match;
  while ((match = boundary.exec(paragraph)) !== null) {
    const word = (paragraph.slice(0, match.index).match(/(\p{L}+)$/u) ?? [])[1] ?? "";
    if (ABBREVIATIONS.has(word.toLowerCase())) continue;
    return paragraph.slice(0, match.index + 1);
  }
  return paragraph;
}

/** A lefordított szerver `tools/list` válasza, stdio-transzporton. Flexet nem hív. */
async function listToolsFromDist() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [distEntry],
    cwd: rootDir,
    // Csak a szükséges minimum: a felhasználó valódi FLEX_* beállításai ne
    // szóljanak bele (egy rossz kombináció kilépéssel járna), Flex-hívás nincs.
    env: { ...getDefaultEnvironment(), FLEX_TOKEN: "manifest-sync-dummy-token" },
    stderr: "ignore",
  });
  const client = new Client({ name: "sync-manifest", version: "0.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return tools.map((tool) => ({ name: tool.name, description: firstSentence(tool.description) }));
  } finally {
    await client.close();
  }
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const changes = [];

if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  changes.push(`verzió → ${pkg.version}`);
}

if (existsSync(distEntry)) {
  const tools = await listToolsFromDist();
  if (JSON.stringify(manifest.tools) !== JSON.stringify(tools)) {
    manifest.tools = tools;
    changes.push(`tools → ${tools.length} eszköz`);
  }
} else {
  console.error(
    `figyelem: ${distEntry} nem létezik, a manifest tools tömbje változatlan. ` +
      `Futtasd az "npm run build"-ot, majd ezt a szkriptet újra.`,
  );
}

if (changes.length > 0) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.error(`manifest.json frissítve: ${changes.join(", ")}`);
} else {
  console.error(`manifest.json már szinkronban (verzió: ${pkg.version}).`);
}
