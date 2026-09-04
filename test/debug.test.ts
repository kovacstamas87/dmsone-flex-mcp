import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { debugRequestBody, isDebugEnabled } from "../src/debug.js";

/**
 * A `FLEX_DEBUG` napló a kimenő kérés-törzsről. Két dolgot őrzünk: alapból
 * néma (a stderr a Claude Desktop naplójába megy, nem szemeteljük tele), és
 * bekapcsolva sem írja ki a csatolmányok base64 tartalmát.
 */
describe("debugRequestBody", () => {
  const original = process.env.FLEX_DEBUG;
  const captured: string[] = [];
  const realError = console.error;

  function capture(): void {
    console.error = (...args: unknown[]) => void captured.push(args.map(String).join(" "));
  }

  afterEach(() => {
    console.error = realError;
    captured.length = 0;
    if (original === undefined) delete process.env.FLEX_DEBUG;
    else process.env.FLEX_DEBUG = original;
  });

  test("alapból néma", () => {
    delete process.env.FLEX_DEBUG;
    capture();
    debugRequestBody("POST /dms/workflow/start", { templateId: 50 });

    assert.equal(isDebugEnabled(), false);
    assert.equal(captured.length, 0);
  });

  test("bekapcsolva a törzs kimegy, de a base64 tartalom nélkül", () => {
    process.env.FLEX_DEBUG = "true";
    capture();
    debugRequestBody("POST /dms/workflow/start", {
      templateId: 50,
      linkedItem: null,
      files: [{ fileName: "a.pdf", content: "QUJDREVG", attachmentTypeCode: null }],
    });

    assert.equal(captured.length, 1);
    const line = captured[0];
    assert.ok(line.includes('"templateId":50'));
    assert.ok(line.includes('"linkedItem":null'), "a null kulcsok is látszanak — pont azokat keressük");
    assert.ok(!line.includes("QUJDREVG"), "a base64 tartalom nem kerülhet a naplóba");
    assert.ok(line.includes("<base64, 8 karakter>"));
  });
});
