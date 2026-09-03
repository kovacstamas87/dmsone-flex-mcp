import { test } from "node:test";
import assert from "node:assert/strict";

import { formatDateTime } from "../src/format.js";
import { DEFAULT_TIME_ZONE, loadConfig } from "../src/config.js";

const BUDAPEST = "Europe/Budapest";

test("offsettel megadott idő a konfigurált zóna faliórájára számol át", () => {
  // Nyári időszámítás (CEST, UTC+2): ugyanaz a pillanat, két írásmód.
  assert.equal(formatDateTime("2026-08-18T23:59:59+02:00", BUDAPEST), "2026-08-18 23:59:59");
  assert.equal(formatDateTime("2026-08-18T21:59:59Z", BUDAPEST), "2026-08-18 23:59:59");
  // Téli időszámítás (CET, UTC+1) — a zóna, nem egy fix eltolás dönt.
  assert.equal(formatDateTime("2026-01-10T10:00:00Z", BUDAPEST), "2026-01-10 11:00:00");
});

test("offset nélküli idő változatlan falióra marad, csak normalizálva", () => {
  assert.equal(formatDateTime("2026-08-18 23:59:59", BUDAPEST), "2026-08-18 23:59:59");
  assert.equal(formatDateTime("2026-08-18T23:59:59", BUDAPEST), "2026-08-18 23:59:59");
  // Másodperc nélkül és törtmásodperccel is: a Flex YYYY-MM-DD HH:mm:ss-t vár.
  assert.equal(formatDateTime("2026-08-18T23:59", BUDAPEST), "2026-08-18 23:59:00");
  assert.equal(formatDateTime("2026-08-18T23:59:59.123", BUDAPEST), "2026-08-18 23:59:59");
});

test("csak dátum esetén a nap kezdete", () => {
  assert.equal(formatDateTime("2026-08-18", BUDAPEST), "2026-08-18 00:00:00");
});

test("a P0-5 hiba nem jön vissza: nincs UTC-re konvertálás", () => {
  // A régi implementáció toISOString()-et használt, ezért egy nyári,
  // +02:00-os határidő két órával korábbra csúszott be a Flexbe.
  assert.notEqual(formatDateTime("2026-08-18T23:59:59+02:00", BUDAPEST), "2026-08-18 21:59:59");
});

test("éjfél 00-ként jön vissza, nem 24-ként", () => {
  // hourCycle: "h23" — enélkül az en-US formázó 24:00:00-t adna.
  assert.equal(formatDateTime("2026-08-17T22:00:00Z", BUDAPEST), "2026-08-18 00:00:00");
});

test("a zóna paraméter érvényesül", () => {
  assert.equal(formatDateTime("2026-08-18T21:59:59Z", "UTC"), "2026-08-18 21:59:59");
  assert.equal(formatDateTime("2026-08-18T21:59:59Z", "America/New_York"), "2026-08-18 17:59:59");
});

test("a +hhmm és a rövid offset alak is érthető", () => {
  assert.equal(formatDateTime("2026-08-18T21:59:59+0000", BUDAPEST), "2026-08-18 23:59:59");
  assert.equal(formatDateTime("2026-08-18T23:59:59+02", BUDAPEST), "2026-08-18 23:59:59");
});

test("üres és értelmezhetetlen bemenet a mai viselkedést tartja", () => {
  assert.equal(formatDateTime(undefined, BUDAPEST), "");
  assert.equal(formatDateTime("", BUDAPEST), "");
  // Változatlanul megy vissza, hogy a Flex saját hibaüzenete jusson el a felhasználóhoz.
  assert.equal(formatDateTime("holnap reggel", BUDAPEST), "holnap reggel");
  assert.equal(formatDateTime("18/08/2026", BUDAPEST), "18/08/2026");
  assert.equal(formatDateTime("2026-08-18T23:59:59 CEST", BUDAPEST), "2026-08-18T23:59:59 CEST");
});

test("a mintára illő, de nem létező időpont sem alakul át", () => {
  // Elírásból nem szabad hihető kinézetű, hamis értéket küldeni a Flexbe.
  assert.equal(formatDateTime("2026-13-45", BUDAPEST), "2026-13-45");
  assert.equal(formatDateTime("2026-02-30", BUDAPEST), "2026-02-30");
  assert.equal(formatDateTime("2026-08-18T25:00:00", BUDAPEST), "2026-08-18T25:00:00");
  assert.equal(formatDateTime("2026-08-18T23:70:00", BUDAPEST), "2026-08-18T23:70:00");
  // Szökőnap: a létező februári 29. viszont átmegy.
  assert.equal(formatDateTime("2028-02-29", BUDAPEST), "2028-02-29 00:00:00");
});

/** A `loadConfig` env-olvasó, ezért a teszt maga állítja és állítja vissza a változót. */
function withEnv<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.FLEX_TIMEZONE;
  if (value === undefined) delete process.env.FLEX_TIMEZONE;
  else process.env.FLEX_TIMEZONE = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.FLEX_TIMEZONE;
    else process.env.FLEX_TIMEZONE = previous;
  }
}

test("a FLEX_TIMEZONE alapértéke Europe/Budapest", () => {
  assert.equal(DEFAULT_TIME_ZONE, "Europe/Budapest");
  assert.equal(
    withEnv(undefined, () => loadConfig().timeZone),
    DEFAULT_TIME_ZONE,
  );
  assert.equal(
    withEnv("   ", () => loadConfig().timeZone),
    DEFAULT_TIME_ZONE,
  );
  assert.equal(
    withEnv("Europe/Vienna", () => loadConfig().timeZone),
    "Europe/Vienna",
  );
});

test("érvénytelen FLEX_TIMEZONE esetén az alapértelmezettre esünk vissza, figyelmeztetéssel", () => {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    assert.equal(
      withEnv("Nem/Letezik", () => loadConfig().timeZone),
      DEFAULT_TIME_ZONE,
    );
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("FLEX_TIMEZONE"), "a figyelmeztetés nevezze meg a változót");
  assert.ok(lines[0].includes(DEFAULT_TIME_ZONE), "és azt is, mire esett vissza");
});
