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
/** Csak az a rész, amit itt ellenőrzünk — a JSON Schema teljes alakja nem kell. */
type JsonSchema = {
  properties?: Record<string, { default?: unknown; enum?: unknown[]; description?: string }>;
  additionalProperties?: unknown;
  required?: string[];
};
type Tool = {
  name: string;
  description?: string;
  annotations?: Annotations;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
};

let client: Client;
let tools: Map<string, Tool>;

before(
  async () => {
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
  },
  { timeout: 30_000 },
);

after(async () => {
  await client?.close();
});

const annotationsOf = (name: string): Annotations => {
  const tool = tools.get(name);
  assert.ok(tool, `hiányzik az eszköz: ${name}`);
  assert.ok(tool.annotations, `${name}: nincs annotáció`);
  return tool.annotations;
};

/** A `tools/list`-ben látszó JSON Schema — a modell ebből olvassa ki az alapértelmezéseket. */
const schemaOf = (name: string): JsonSchema => {
  const tool = tools.get(name);
  assert.ok(tool, `hiányzik az eszköz: ${name}`);
  assert.ok(tool.inputSchema, `${name}: nincs inputSchema`);
  return tool.inputSchema;
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

/**
 * WF9: a két listázó alapból **szűrt és lapozott** választ ad. Ha a leírás
 * ezt elhallgatná, a modell teljes listát hinne, és a hiányzó elemeket a
 * rendszer hibájának venné a lapozás helyett.
 */
test("a listázók leírása kimondja a lapozást és az összefoglaló alapértelmezést", () => {
  for (const name of ["flex_task_list", "flex_workflow_get_my_tasks"]) {
    const description = tools.get(name)?.description ?? "";
    const schema = schemaOf(name);

    assert.ok(/lapoz/i.test(description), `${name}: a leírás nem mondja ki a lapozást`);
    assert.ok(description.includes("20"), `${name}: nincs megnevezve az alapértelmezett limit`);
    assert.ok(description.includes("hasMore"), `${name}: a boríték nincs leírva`);

    for (const key of ["limit", "offset", "fields"]) {
      assert.ok(key in (schema.properties ?? {}), `${name}: hiányzik a ${key} paraméter`);
    }
    assert.deepEqual(schema.properties?.fields?.enum, ["summary", "full"], `${name}: fields enum`);
    assert.equal(schema.properties?.limit?.default, 20, `${name}: a limit alapértelmezése`);
  }
});

test("a feladatlista leírása megmondja, mi marad ki az összefoglalóból", () => {
  const description = tools.get("flex_task_list")?.description ?? "";
  assert.ok(/NEM szerepel/.test(description), "nem mondja ki, hogy a részletek kimaradnak");
  assert.ok(
    description.includes("flex_workflow_get_task_details"),
    "nem mutat rá, honnan jönnek a részletek",
  );
  // A `/dms/news` vegyes listát ad — ha ezt elhallgatjuk, a modell Task-ként
  // próbálna lezárni egy WfTask-ot.
  assert.ok(description.includes("WfTask"), "nem jelzi, hogy a lista vegyes");
});

/**
 * WF11: a `/dms/news` vegyes listáján az `idKind` mondja meg, melyik eszközcsalád
 * kezeli az elemet — a leírás és a szerver-instrukció is erre mutat rá, nem csak a
 * `type`-ra, mert a modellnek konkrét eszköznevet kell kiválasztania.
 */
test("a feladatlista leírása az idKind-re mutat, nem csak a type-ra", () => {
  const description = tools.get("flex_task_list")?.description ?? "";
  assert.ok(description.includes("idKind"), "nem említi az idKind mezőt");
  assert.ok(description.includes("taskId"), "nem mondja ki a taskId jelentését");
  assert.ok(description.includes("wfTaskId"), "nem mondja ki a wfTaskId jelentését");
});

/**
 * WF11 (P1-5/P1-6 MCP): a korábbi `orgId` `1` alapértelmezés elrejthette, hogy a
 * feladat/folyamat rossz szervezeti egységhez kerül. A `tools/list`-ben ezért az
 * `orgId` mezőknek **nincs** `default`-juk — a modellnek explicit kell megadnia,
 * a `flex_user_get_by_username` válaszából.
 */
test("az orgId mezőknek nincs alapértelmezésük", () => {
  const workflowOrgId = schemaOf("flex_workflow_start").properties?.responsibleOrgId;
  assert.equal(
    workflowOrgId?.default,
    undefined,
    "a responsibleOrgId-nak nem lenne szabad alapértelmezettnek lennie",
  );

  const taskOrgId = schemaOf("flex_task_create").properties?.performerOrgId;
  assert.equal(
    taskOrgId?.default,
    undefined,
    "a performerOrgId-nak nem lenne szabad alapértelmezettnek lennie",
  );
});

/**
 * WF10: a paraméter-magyarázatok a leírásból a séma `.describe()`-jába kerültek.
 * Az őr tehát ott néz, ahol az ígéret most áll — a `tools/list` inputSchema-jában.
 */
test("a sablon-részletek nyers válasza opcionális, és ez a paraméternél is látszik", () => {
  const schema = schemaOf("flex_workflow_get_template_details");
  const includeRaw = schema.properties?.includeRaw;

  assert.equal(includeRaw?.default, false, "az includeRaw alapból hamis");
  assert.ok(includeRaw?.description, "az includeRaw-nak nincs magyarázata");
  assert.ok(
    /normaliz/.test(includeRaw.description),
    "a magyarázat nem mondja meg, miért marad ki alapból a nyers válasz",
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

/**
 * WF10 — leírás-költségvetés. A `tools/list` minden munkamenet elején bekerül a
 * modell kontextusába, tehát a leírások hossza állandó, fizetett teher. A felső
 * határ azért teszt, mert egy „csak még egy mondat" itt észrevétlenül visszahízik.
 *
 * A paraméter-magyarázatok helye a séma `.describe()`-ja, a válasz alakjának
 * helye az `outputSchema` — a leírásban „Mikor használd" + egy mondat a
 * visszatérésről marad.
 */
test("az összleírás a költségvetésen belül van", () => {
  const total = [...tools.values()].reduce((sum, tool) => sum + (tool.description?.length ?? 0), 0);
  const perTool = [...tools.values()]
    .map((tool) => `${tool.name}: ${tool.description?.length ?? 0}`)
    .join(", ");

  assert.ok(total < 4500, `az összleírás ${total} karakter (< 4500 kell) — ${perTool}`);
  assert.ok(total > 2000, `az összleírás ${total} karakter: ennyiből valami kiesett`);
});

/**
 * WF10 — `outputSchema` csak ott, ahol a szerver maga építi a választ. A
 * passthrough eszközök a Flex nyers válaszát adják: az ő alakjukra nincs
 * szerződésünk, és egy hibás séma az SDK validációján **elszállasztaná** a
 * hívást (lásd `src/schema.ts`).
 */
test("outputSchema pontosan a szerver által épített válaszokon van", () => {
  const expected = [
    "flex_diag",
    "flex_task_list",
    "flex_workflow_get_my_tasks",
    "flex_workflow_get_template_details",
    "flex_workflow_download_attachment",
  ].sort();

  const actual = [...tools.values()]
    .filter((tool) => tool.outputSchema)
    .map((tool) => tool.name)
    .sort();

  assert.deepEqual(actual, expected);
});

test("az outputSchema laza: nincs kötelező mező, és átengedi az ismeretlen kulcsokat", () => {
  for (const tool of tools.values()) {
    if (!tool.outputSchema) continue;
    // Miért: a csonkolás-ág és a listázók fallbackje más alakot ad — kötelező
    // mezővel vagy zárt objektummal ezek élesben protokollhibát okoznának.
    assert.equal(tool.outputSchema.additionalProperties, true, `${tool.name}: nem passthrough`);
    assert.equal(tool.outputSchema.required, undefined, `${tool.name}: kötelező mezőt ír elő`);
  }
});
