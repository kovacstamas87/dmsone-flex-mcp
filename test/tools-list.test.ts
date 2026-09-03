import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * A szervert valódi stdio-transzporton indítjuk el (ahogy a Claude Desktop teszi),
 * és a `tools/list` választ nézzük. Miért nem unit-teszt: az annotációk a
 * `registerTool` hívásban vannak, és az a kérdés, hogy a **kliens mit lát** —
 * ezt csak a protokollon át lehet őszintén ellenőrizni. Hálózat nem kell: a
 * `tools/list` nem hív Flexet, a token dummy.
 */
const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

type Annotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};
type Tool = { name: string; description?: string; annotations?: Annotations };

let client: Client;
let tools: Map<string, Tool>;

before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    cwd: rootDir,
    env: { ...(process.env as Record<string, string>), FLEX_TOKEN: "dummy-token-only-for-tools-list-test" },
    stderr: "ignore",
  });
  client = new Client({ name: "tools-list-test", version: "0.0.0" });
  await client.connect(transport);
  const list = await client.listTools();
  tools = new Map((list.tools as Tool[]).map((tool) => [tool.name, tool]));
}, { timeout: 30_000 });

after(async () => {
  await client?.close();
});

const annotationsOf = (name: string): Annotations => {
  const tool = tools.get(name);
  assert.ok(tool, `hiányzik az eszköz: ${name}`);
  assert.ok(tool.annotations, `${name}: nincs annotáció`);
  return tool.annotations;
};

test("19 eszköz van regisztrálva", () => {
  assert.equal(tools.size, 19, [...tools.keys()].sort().join(", "));
});

test("flex_workflow_download_attachment: fájlt ír, nem idempotens, nem destruktív", () => {
  assert.deepEqual(annotationsOf("flex_workflow_download_attachment"), {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  });
});

test("a visszavonhatatlan műveletek destruktívként vannak jelölve", () => {
  for (const name of ["flex_workflow_complete_task", "flex_task_complete", "flex_workflow_start"]) {
    const a = annotationsOf(name);
    assert.equal(a.destructiveHint, true, `${name}: destructiveHint`);
    assert.equal(a.readOnlyHint, false, `${name}: readOnlyHint`);
  }
});

test("flex_task_accept marad nem destruktív", () => {
  const a = annotationsOf("flex_task_accept");
  assert.equal(a.destructiveHint, false);
  assert.equal(a.readOnlyHint, false);
});

test("a csak-olvasó eszközök következetesek: readOnly → nem destruktív, idempotens", () => {
  for (const [name, tool] of tools) {
    if (tool.annotations?.readOnlyHint) {
      assert.equal(tool.annotations.destructiveHint, false, `${name}: read-only, de destruktív`);
      assert.equal(tool.annotations.idempotentHint, true, `${name}: read-only, de nem idempotens`);
    }
  }
});

test("egyetlen eszköz sem readOnly, ha a lemezre vagy a Flexbe ír", () => {
  const writers = [
    "flex_task_create",
    "flex_task_comment",
    "flex_task_accept",
    "flex_task_complete",
    "flex_workflow_start",
    "flex_workflow_complete_task",
    "flex_workflow_add_task_comment",
    "flex_workflow_download_attachment",
  ];
  for (const name of writers) {
    assert.equal(annotationsOf(name).readOnlyHint, false, `${name}: readOnlyHint`);
  }
});

test("a letöltés leírása a sandboxot mondja, nem ígér tetszőleges útvonalat", () => {
  const description = tools.get("flex_workflow_download_attachment")?.description ?? "";
  assert.ok(description.includes("letöltési könyvtár"), "hiányzik a letöltési könyvtár említése");
  assert.ok(!/teljes útvonal/i.test(description), "a leírás még tetszőleges (teljes) útvonalat ígér");
  assert.ok(/nem ír felül/.test(description), "a leírás nem mondja ki, hogy nem ír felül");
});

/**
 * WF4 kész-kritériuma: „a két érintett tool-leírás nem ígér többet, mint amit tesz".
 * A `tools/list` szövegét nézzük, mert a modell pontosan ezt kapja.
 */
test("a sablon-részletek leírása a validation mezőre bízza a kötelezőséget", () => {
  const description = tools.get("flex_workflow_get_template_details")?.description ?? "";
  assert.ok(description.includes("validation"), "hiányzik a validation mező magyarázata");
  assert.ok(!/MINDIG/.test(description), "a leírás még feltétel nélküli kötelezőséget ígér");
});

test("az indítás leírása kimondja, hogy az ellenőrzés best-effort", () => {
  const description = tools.get("flex_workflow_start")?.description ?? "";
  assert.ok(/best-effort/i.test(description), "a leírás nem jelzi, hogy az ellenőrzés best-effort");
  assert.ok(
    description.includes("Flex\nszerver érvényesíti") || description.includes("Flex szerver érvényesíti"),
    "a leírás nem mondja ki, hogy az érdemi ellenőrzés a szerveré",
  );
});

test("a dátumot fogadó eszközök leírása a falióra-szemantikát mondja", () => {
  for (const name of ["flex_task_create", "flex_workflow_start"]) {
    const description = tools.get(name)?.description ?? "";
    // A szótő az invariáns: „faliórát" / „faliórája" / „faliórának".
    assert.ok(/faliór/.test(description), `${name}: hiányzik a falióra-szemantika`);
    assert.ok(description.includes("FLEX_TIMEZONE"), `${name}: nincs megnevezve a zóna forrása`);
  }
});
