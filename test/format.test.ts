import { test } from "node:test";
import assert from "node:assert/strict";

import { formatError, toolJson } from "../src/format.js";
import { REDACTED } from "../src/redact.js";

const FAKE_TOKEN = "mvp_0123456789abcdefghijklmnop";

/** Az axios hibaobjektum minimál mása — az `isAxiosError` az, amit az axios néz. */
function axiosError(status: number, data: unknown): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

test("a toolJson a text-et és a structuredContent-et is redaktálja", () => {
  const result = toolJson({
    result: { req: { Authorization: `Bearer ${FAKE_TOKEN}` }, method: "GET" },
  });

  assert.ok(!result.content[0].text.includes(FAKE_TOKEN));
  assert.ok(!JSON.stringify(result.structuredContent).includes(FAKE_TOKEN));
  assert.ok(result.content[0].text.includes("GET"), "a hasznos adat megmarad");
});

test("a toolJson a valós eredményt nem bántja", () => {
  const data = { success: true, taskId: 42, metadata: { OSSZEG: 1000 } };
  const result = toolJson(data);

  assert.deepEqual(result.structuredContent, data);
  assert.equal(result.content[0].text, JSON.stringify(data, null, 2));
});

test("a toolJson tömb esetén a result burkolót használja", () => {
  const result = toolJson([{ taskId: 1 }]);
  assert.deepEqual(result.structuredContent, { result: [{ taskId: 1 }] });
});

test("a hibatörzs 2000 karakterre csonkolódik", () => {
  const body = "x".repeat(10000);
  const message = formatError(axiosError(500, body));

  const bodyPart = message.slice(message.indexOf("Válasz: ") + "Válasz: ".length);
  assert.ok(bodyPart.endsWith("… [csonkolva]"), "hiányzik a csonkolás jelzése");
  assert.equal(bodyPart.length, 2000 + "… [csonkolva]".length);
  assert.ok(message.startsWith("Hiba: A Flex szerver belső hibát adott (500)."));
});

test("a rövid hibatörzs változatlanul megy vissza", () => {
  const message = formatError(axiosError(400, { error: "hiányzó mező: OSSZEG" }));
  assert.equal(
    message,
    'Hiba: Hibás kérés (400). Ellenőrizd a kötelező mezőket és a paraméterek formátumát.\n' +
      'Válasz: {"error":"hiányzó mező: OSSZEG"}',
  );
});

test("a hibatörzs is redaktált", () => {
  const message = formatError(
    axiosError(401, { error: "unauthorized", request: { authorization: `Bearer ${FAKE_TOKEN}` } }),
  );

  assert.ok(!message.includes(FAKE_TOKEN));
  assert.ok(message.includes(REDACTED));
  assert.ok(message.startsWith("Hiba: Érvénytelen vagy lejárt token (401)."));
});

test("hálózati hiba és timeout üzenete változatlan", () => {
  const timeout = Object.assign(new Error("timeout"), { isAxiosError: true, code: "ECONNABORTED" });
  assert.equal(formatError(timeout), "Hiba: a kérés időtúllépés miatt megszakadt. Próbáld újra.");

  const offline = Object.assign(new Error("connect ECONNREFUSED"), {
    isAxiosError: true,
    code: "ECONNREFUSED",
  });
  assert.ok(formatError(offline).includes("nem sikerült elérni a Flex API-t (ECONNREFUSED)"));
});

/**
 * A P0-1 kész-kritériuma: nincs eszköz, amely megkerüli a redakciót. Ez a teszt
 * a forrást nézi, mert a megkerülés nem futásidejű hiba, hanem szerkesztési:
 * ha valaki kézzel állít össze egy `content: [...]` eredményt a tools/ alatt,
 * az kiesik a `toolJson` szűrőjéből.
 */
test("egyetlen eszköz sem állít elő tool-eredményt a format.ts megkerülésével", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const toolsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "tools");
  for (const file of readdirSync(toolsDir).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(join(toolsDir, file), "utf8");
    // A `content: [` a tool-eredmény alakja; a `content:` önmagában lehet
    // kérés-mező is (a workflow start csatolmány-blokkja ilyen).
    for (const marker of [/content:\s*\[/, /structuredContent/, /isError/]) {
      assert.ok(
        !marker.test(source),
        `${file}: a ${marker} kézi tool-eredményre utal — használd a toolJson/toolError függvényt`,
      );
    }
  }
});
