import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { envelope, paginate, summarizeTask, summarizeWfTask } from "../src/projection.js";

/** A fixture-ök élő, read-only mintából készültek, anonimizálva — lásd `test/CLAUDE.md`. */
function fixture(name: string): { success: boolean; result: Record<string, unknown>[] } {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"));
}

const NEWS = fixture("task-list");
const WF_TASKS = fixture("wf-tasks");

describe("summarizeTask", () => {
  test("a drága mezők nincsenek benne", () => {
    for (const item of NEWS.result) {
      const summary = summarizeTask(item);
      for (const key of [
        "taskDescription",
        "wfDescription",
        "metaItems",
        "comments",
        "attachments",
        "possibleResults",
      ]) {
        assert.ok(!(key in summary), `${key} nem kerülhet a summary-be`);
      }
      assert.ok(!JSON.stringify(summary).includes("<p>"), "HTML nem szivároghat át");
    }
  });

  test("a navigációhoz kellő mezők megvannak", () => {
    const summary = summarizeTask(NEWS.result[0]);
    assert.deepEqual(Object.keys(summary).sort(), [
      "attachmentCount",
      "commentCount",
      "creatorName",
      "id",
      "idKind",
      "referenceNumber",
      "status",
      "subject",
      "taskDeadline",
      "taskName",
      "taskStart",
      "taskStatus",
      "template",
      "templateVersion",
      "type",
    ]);
  });

  test("a lista vegyesen tartalmaz Task és WfTask elemet — mindkettő átmegy", () => {
    const types = new Set(NEWS.result.map((item) => summarizeTask(item).type));
    assert.deepEqual([...types].sort(), ["Task", "WfTask"]);
  });

  test("az idKind a type-ból származik: WfTask -> wfTaskId, minden más -> taskId", () => {
    for (const item of NEWS.result) {
      const summary = summarizeTask(item);
      assert.equal(summary.idKind, item.type === "WfTask" ? "wfTaskId" : "taskId");
    }
  });

  test("a templateName objektumból lapos template + templateVersion lesz", () => {
    const withTemplate = NEWS.result.find((item) => item.templateName !== null)!;
    const summary = summarizeTask(withTemplate);
    assert.equal(typeof summary.template, "string");
    assert.equal(typeof summary.templateVersion, "number");
  });

  test("a hiányzó templateName / creator nem dob, null lesz", () => {
    const summary = summarizeTask({ id: 1, type: "Task", templateName: null, creator: null });
    assert.equal(summary.template, null);
    assert.equal(summary.templateVersion, null);
    assert.equal(summary.creatorName, null);
  });

  test("a megjegyzés és a csatolmány darabszámmal marad meg", () => {
    const item = NEWS.result.find((entry) => (entry.comments as unknown[]).length > 0)!;
    const summary = summarizeTask(item);
    assert.equal(summary.commentCount, (item.comments as unknown[]).length);
    assert.equal(summary.attachmentCount, (item.attachments as unknown[]).length);
  });

  test("a 21 elemes minta summary-ja 8 KB alatt van", () => {
    const summarized = JSON.stringify(NEWS.result.map(summarizeTask));
    const raw = JSON.stringify(NEWS);
    assert.ok(summarized.length < 8000, `summary ${summarized.length} karakter, a határ 8000`);
    // A kész-kritérium a méret; ez a sor csak kimondja, mekkora a nyereség.
    assert.ok(summarized.length < raw.length / 5);
  });
});

describe("summarizeWfTask", () => {
  test("a hét ismert mezőt adja vissza", () => {
    const summary = summarizeWfTask(WF_TASKS.result[0]);
    assert.deepEqual(Object.keys(summary).sort(), [
      "status",
      "template",
      "templateVersion",
      "type",
      "wfSubject",
      "wfTaskId",
      "wfTaskName",
    ]);
  });

  test("engedélyező lista: a később hozzáadott mező nem kerül át", () => {
    const summary = summarizeWfTask({ ...WF_TASKS.result[0], wfDescription: "<p>hosszú</p>" });
    assert.ok(!("wfDescription" in summary));
  });
});

describe("paginate", () => {
  test("az alapértelmezett ablak és a hasMore", () => {
    const items = Array.from({ length: 25 }, (_, index) => index);
    const { page, total, hasMore } = paginate(items, 0, 20);
    assert.equal(page.length, 20);
    assert.equal(total, 25);
    assert.equal(hasMore, true);
  });

  test("az utolsó lapon nincs hasMore", () => {
    const items = Array.from({ length: 25 }, (_, index) => index);
    const { page, hasMore } = paginate(items, 20, 20);
    assert.deepEqual(page, [20, 21, 22, 23, 24]);
    assert.equal(hasMore, false);
  });

  test("a túlfutó offset üres lap, nem hiba", () => {
    const { page, total, hasMore } = paginate([1, 2, 3], 99, 20);
    assert.deepEqual(page, []);
    assert.equal(total, 3);
    assert.equal(hasMore, false);
  });

  test("a negatív offset a lista elejét adja", () => {
    const { page } = paginate([1, 2, 3], -5, 2);
    assert.deepEqual(page, [1, 2]);
  });

  test("üres listán is helyes", () => {
    const { page, total, hasMore } = paginate([], 0, 20);
    assert.deepEqual(page, []);
    assert.equal(total, 0);
    assert.equal(hasMore, false);
  });
});

describe("envelope", () => {
  test("a boríték mezői és az alapértelmezett lap", () => {
    const page = envelope(NEWS, { offset: 0, limit: 20, fields: "summary" }, summarizeTask)!;
    assert.deepEqual(Object.keys(page).sort(), ["fields", "hasMore", "items", "offset", "returned", "total"]);
    assert.equal(page.total, 21);
    assert.equal(page.returned, 20);
    assert.equal(page.hasMore, true);
    assert.equal(page.fields, "summary");
  });

  test("a full mód a nyers elemeket adja", () => {
    const page = envelope(NEWS, { offset: 0, limit: 1, fields: "full" }, summarizeTask)!;
    assert.deepEqual(page.items[0], NEWS.result[0]);
    assert.equal(page.returned, 1);
    assert.equal(page.hasMore, true);
  });

  test("a wf-feladatok listája ugyanezt a borítékot kapja", () => {
    const page = envelope(WF_TASKS, { offset: 20, limit: 20, fields: "summary" }, summarizeWfTask)!;
    assert.equal(page.total, 25);
    assert.equal(page.offset, 20);
    assert.equal(page.returned, 5);
    assert.equal(page.hasMore, false);
  });

  test("a túlfutó offset a totálra vágódik vissza", () => {
    const page = envelope(NEWS, { offset: 500, limit: 20, fields: "summary" }, summarizeTask)!;
    assert.equal(page.offset, 21);
    assert.equal(page.returned, 0);
    assert.equal(page.hasMore, false);
  });

  test("nem tömb result esetén undefined — a hívó a nyers választ küldi tovább", () => {
    assert.equal(
      envelope(
        { success: true, result: { id: 1 } },
        { offset: 0, limit: 20, fields: "summary" },
        summarizeTask,
      ),
      undefined,
    );
    assert.equal(envelope(null, { offset: 0, limit: 20, fields: "summary" }, summarizeTask), undefined);
    assert.equal(envelope("szöveg", { offset: 0, limit: 20, fields: "summary" }, summarizeTask), undefined);
  });
});
