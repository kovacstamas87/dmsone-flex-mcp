import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { validateConfig, loadConfig, DEFAULT_TIME_ZONE, type FlexConfig } from "../src/config.js";

const base: FlexConfig = {
  baseUrl: "https://flex.dmsone.hu/api",
  authMethod: "pat",
  token: "valid-token",
  impersonatedEmail: undefined,
  ignoreSsl: false,
  downloadDir: undefined,
  timeZone: DEFAULT_TIME_ZONE,
  maxDownloadBytes: 50 * 1024 * 1024,
};

describe("validateConfig", () => {
  test("minden rendben: nincs hiba, nincs figyelmeztetés", () => {
    const { errors, warnings } = validateConfig(base);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  test("üres token: hiba", () => {
    const { errors, warnings } = validateConfig({ ...base, token: "" });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /FLEX_TOKEN környezeti változó kötelező/);
    assert.deepEqual(warnings, []);
  });

  test("SSL kikapcsolva a publikus URL-en: hiba", () => {
    const { errors, warnings } = validateConfig({ ...base, ignoreSsl: true });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /publikus Flex URL-en \(flex\.dmsone\.hu\) nem engedett/);
    assert.deepEqual(warnings, []);
  });

  test("SSL kikapcsolva más URL-en: csak figyelmeztetés", () => {
    const { errors, warnings } = validateConfig({
      ...base,
      baseUrl: "https://flex-dev.dmsone.hu/api",
      ignoreSsl: true,
    });
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /TLS-ellenőrzés kikapcsolva — csak fejlesztéshez/);
  });

  test("PAT mód impersonációval: csak figyelmeztetés", () => {
    const { errors, warnings } = validateConfig({
      ...base,
      authMethod: "pat",
      impersonatedEmail: "valaki@example.com",
    });
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /PAT módban az impersonáció nem érvényesül/);
  });

  test("station mód impersonációval: nincs figyelmeztetés", () => {
    const { errors, warnings } = validateConfig({
      ...base,
      authMethod: "station",
      impersonatedEmail: "valaki@example.com",
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  test("több hiba/figyelmeztetés egyszerre is összegyűlik", () => {
    const { errors, warnings } = validateConfig({
      ...base,
      token: "",
      ignoreSsl: true, // publikus URL-en → hiba, nem csak figyelmeztetés
      authMethod: "pat",
      impersonatedEmail: "valaki@example.com",
    });
    assert.equal(errors.length, 2);
    assert.equal(warnings.length, 1);
  });

  test("érvénytelen baseUrl SSL-kikapcsolással: figyelmeztetés, nem dob", () => {
    const { errors, warnings } = validateConfig({ ...base, baseUrl: "not-a-url", ignoreSsl: true });
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
  });
});

/** A `loadConfig` env-olvasó, ezért a teszt maga állítja és állítja vissza a változót. */
function withCheckOnStart<T>(value: string | undefined, run: () => T): T {
  const original = process.env.FLEX_CHECK_ON_START;
  if (value === undefined) delete process.env.FLEX_CHECK_ON_START;
  else process.env.FLEX_CHECK_ON_START = value;
  try {
    return run();
  } finally {
    if (original === undefined) delete process.env.FLEX_CHECK_ON_START;
    else process.env.FLEX_CHECK_ON_START = original;
  }
}

describe("loadConfig — FLEX_CHECK_ON_START", () => {
  test("alapból kikapcsolva", () => {
    assert.equal(
      withCheckOnStart(undefined, () => loadConfig().checkOnStart),
      false,
    );
  });

  test("üres string: kikapcsolva", () => {
    assert.equal(
      withCheckOnStart("", () => loadConfig().checkOnStart),
      false,
    );
  });

  for (const truthyValue of ["1", "true", "yes", "on", "TRUE"]) {
    test(`"${truthyValue}": bekapcsolva`, () => {
      assert.equal(
        withCheckOnStart(truthyValue, () => loadConfig().checkOnStart),
        true,
      );
    });
  }

  for (const falsyValue of ["0", "false", "no", "off"]) {
    test(`"${falsyValue}": kikapcsolva`, () => {
      assert.equal(
        withCheckOnStart(falsyValue, () => loadConfig().checkOnStart),
        false,
      );
    });
  }
});
