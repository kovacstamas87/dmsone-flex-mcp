import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { z } from "zod";

import { toolJson } from "../src/format.js";
import { envelope, summarizeTask, summarizeWfTask } from "../src/projection.js";
import {
  diagOutput,
  downloadOutput,
  taskListOutput,
  templateDetailsOutput,
  wfTaskListOutput,
} from "../src/schema.js";
import { pickDiagFields } from "../src/tools/diagnostic.js";
import { describeTemplate } from "../src/tools/workflow.js";

/**
 * Az `outputSchema` **élesben validál**: az SDK a `structuredContent`-et
 * lefuttatja a sémán, és hibára az egész tool-hívás elszáll (lásd
 * `src/schema.ts`). Ezért itt nem azt teszteljük, hogy a séma szigorú, hanem az
 * ellenkezőjét: **valós alakú válaszon soha ne bukjon** — sem az összefoglaló,
 * sem a nyers, sem a csonkolt, sem a váratlan-alak (fallback) ágon.
 *
 * A séma ugyanazt a `structuredContent`-et kapja, amit a kliens: minden eset a
 * `toolJson`-on megy át, nem a nyers objektumon.
 */
type AnySchema = z.ZodTypeAny;

/** A `toolJson` által előállított `structuredContent` — pont ezt validálja az SDK. */
function structured(data: unknown): Record<string, unknown> {
  const result = toolJson(data);
  assert.ok(result.structuredContent, "a toolJson mindig ad structuredContent-et");
  return result.structuredContent;
}

function expectValid(schema: AnySchema, data: unknown, label: string): void {
  const parsed = schema.safeParse(data);
  assert.ok(parsed.success, `${label}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
}

/** A fixture-ök élő, read-only mintából készültek, anonimizálva — lásd `test/CLAUDE.md`. */
function fixture(name: string): { success: boolean; result: Record<string, unknown>[] } {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"));
}

const NEWS = fixture("task-list");
const WF_TASKS = fixture("wf-tasks");

/** A 66-os sablon alakja: mezőkódokkal kulcsolt `metadata`, kötelezőség-jelölés nélkül. */
const TEMPLATE_66 = {
  success: true,
  result: {
    metadata: {
      partnerNev: { code: "partnerNev", name: "Partner neve", type: "Text", visibility: "MT_K" },
      fizetesiMod: {
        code: "fizetesiMod",
        name: "Fizetési mód",
        type: "Option",
        visibility: "MT_M",
        params: "|atutalas;keszpenz;kartya",
      },
    },
    allowedLinkedItemTypes: ["alszam", "foszam"],
  },
};

const ALL_SCHEMAS: [string, AnySchema][] = [
  ["diagOutput", diagOutput],
  ["templateDetailsOutput", templateDetailsOutput],
  ["downloadOutput", downloadOutput],
  ["taskListOutput", taskListOutput],
  ["wfTaskListOutput", wfTaskListOutput],
];

describe("diagOutput", () => {
  test("a /diag szűrt válaszára illeszkedik", () => {
    // A nyers /diag visszatükrözi a fejléceket és a backend env-jét; ezek a
    // `pickDiagFields` után nincsenek benne, a séma mégis engedi az extra kulcsot.
    const raw = {
      success: true,
      result: {
        method: "GET",
        uri: "/diag",
        qs: { greeting: "hello" },
        req: { Authorization: "Bearer titok" },
        server: { APP_KEY: "titok" },
      },
    };
    expectValid(diagOutput, structured(pickDiagFields(raw)), "szűrt /diag");
  });

  test("üres válaszra is illeszkedik (csak ok: true)", () => {
    expectValid(diagOutput, structured(pickDiagFields({})), "üres /diag");
  });
});

describe("templateDetailsOutput", () => {
  test('a "none" ág (note-tal) és az includeRaw ág is átmegy', () => {
    expectValid(templateDetailsOutput, structured(describeTemplate(66, TEMPLATE_66)), "validation: none");
    expectValid(
      templateDetailsOutput,
      structured(describeTemplate(66, TEMPLATE_66, true)),
      "includeRaw: true",
    );
  });

  test("mezők nélküli sablon sem bukik el", () => {
    expectValid(templateDetailsOutput, structured(describeTemplate(1, {})), "üres sablon");
  });
});

describe("downloadOutput", () => {
  test("a mentés nyugtájára illeszkedik, contentType nélkül is", () => {
    const receipt = {
      success: true,
      filePath: "/tmp/dmsone-flex/szamla.pdf",
      fileName: "szamla.pdf",
      downloadDir: "/tmp/dmsone-flex",
      bytes: 1234,
      contentType: "application/pdf",
    };
    expectValid(downloadOutput, structured(receipt), "teljes nyugta");
    expectValid(downloadOutput, structured({ ...receipt, contentType: undefined }), "contentType nélkül");
  });
});

describe("a listázók borítéka", () => {
  const cases: [
    string,
    AnySchema,
    typeof NEWS,
    (item: Record<string, unknown>) => Record<string, unknown>,
  ][] = [
    ["flex_task_list", taskListOutput, NEWS, summarizeTask],
    ["flex_workflow_get_my_tasks", wfTaskListOutput, WF_TASKS, summarizeWfTask],
  ];

  for (const [name, schema, payload, summarize] of cases) {
    test(`${name}: summary és full mód is illeszkedik`, () => {
      // A `full` mód a **nyers** elemeket adja, és 21 nyers /dms/news elem már a
      // csonkolás-ágra futna (mérés: 50 140 karakter) — azt a lentebbi teszt
      // fogja. Itt a nyers elem *alakja* a kérdés, ezért kicsi a limit.
      for (const [fields, limit] of [
        ["summary", 100],
        ["full", 3],
      ] as const) {
        const page = envelope(payload, { offset: 0, limit, fields }, summarize);
        assert.ok(page, "az envelope borítékot ad a fixture alakjára");
        const content = structured(page);
        assert.ok(!content.truncated, `${name} / ${fields}: ez az eset nem csonkolhat`);
        expectValid(schema, content, `${name} / ${fields}`);
      }
    });

    test(`${name}: a váratlan válaszalak (fallback) is átmegy`, () => {
      // Ha a `result` nem tömb, az `envelope` undefined-et ad, és a nyers payload
      // megy tovább boríték nélkül — a séma ezt sem utasíthatja el.
      const odd = { success: false, result: { error: "váratlan alak" } };
      assert.equal(envelope(odd, { offset: 0, limit: 20, fields: "summary" }, summarize), undefined);
      expectValid(schema, structured(odd), `${name} / fallback`);
    });
  }
});

test("a csonkolt structuredContent minden sémán átmegy", () => {
  // A `toolJson` a méretkorlát fölött erre az alakra cseréli a structuredContent-et.
  const huge = structured({ items: [{ blob: "x".repeat(60_000) }] });
  assert.equal(huge.truncated, true, "a nagy bemenet valóban a csonkolás-ágra megy");

  for (const [label, schema] of ALL_SCHEMAS) {
    expectValid(schema, huge, `${label} / csonkolt`);
  }
});
