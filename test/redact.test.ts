import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REDACTED,
  clearSecretValues,
  redactSecrets,
  registerSecretValue,
} from "../src/redact.js";

/**
 * A `/diag` válaszának alakja — a tokenek és kulcsok **kitaláltak**, valós titok
 * nem kerülhet a repóba. A szerkezet (req/server/cookies burkolók) az, ami számít.
 */
const FAKE_TOKEN = "mvp_0123456789abcdefghijklmnop";
const diagResponse = {
  success: true,
  result: {
    method: "GET",
    uri: "/api/diag",
    qs: { greeting: "szia" },
    req: {
      Authorization: `Bearer ${FAKE_TOKEN}`,
      "X-Impersonated-User-Email": "teszt.elek@pelda.hu",
      Accept: "application/json",
    },
    cookies: { flex_session: "abc123" },
    server: {
      HTTP_AUTHORIZATION: `Bearer ${FAKE_TOKEN}`,
      APP_KEY: "base64:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo9",
      APP_ENV: "production",
      TENANT_ID: "42",
    },
  },
};

test("a diag-válaszból nem marad token, APP_KEY vagy Bearer-fejléc", () => {
  const text = JSON.stringify(redactSecrets(diagResponse));

  assert.ok(!text.includes(FAKE_TOKEN), "a token nem maradhat a kimenetben");
  assert.ok(!text.includes("mvp_"), "a Flex tokenprefix nem maradhat a kimenetben");
  assert.ok(!text.includes("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo9"), "az APP_KEY értéke nem maradhat");
  assert.ok(!/Bearer\s+\S*mvp/.test(text), "nem maradhat kitöltött Bearer-fejléc");
});

test("a nem titkos diag-mezők megmaradnak", () => {
  const safe = redactSecrets(diagResponse) as typeof diagResponse;

  assert.equal(safe.result.method, "GET");
  assert.equal(safe.result.uri, "/api/diag");
  assert.deepEqual(safe.result.qs, { greeting: "szia" });
  assert.equal(safe.result.server.APP_ENV, "production");
  assert.equal(safe.result.server.TENANT_ID, "42");
});

test("a kulcs-minták típustól függetlenül fognak", () => {
  const safe = redactSecrets({
    authorization: "Basic abc",
    HTTP_AUTHORIZATION: "akármi",
    Cookie: "a=1",
    "set-cookie": ["a=1", "b=2"],
    apiToken: { value: "titok", expires: "2026-01-01" },
    app_secret: 12345,
    user_password: null,
    api_key: "x",
    "X-Api-Key": "x",
    APP_KEY: "x",
    refreshTokenExpiry: "2026-01-01",
  }) as Record<string, unknown>;

  for (const key of Object.keys(safe)) {
    assert.equal(safe[key], REDACTED, `${key} nem lett redaktálva`);
  }
});

test("a valós Flex-mezők érintetlenek maradnak", () => {
  const payload = {
    success: true,
    taskId: 12345,
    wfTaskId: 6789,
    templateId: 66,
    attachmentGuid: "3f1c9a2e-0000-4a11-9c3f-abcdef012345",
    referenceNumber: "DMS/13/2023",
    possibleWfTaskResults: [
      { code: "OK", name: "Jóváhagyva" },
      { code: "REJ", name: "Elutasítva" },
    ],
    metadata: {
      MEGJEGYZES: "szöveg",
      OSSZEG: 1000,
      HATARIDO: "2026-08-18 23:59:59",
      visibility: "MT_K",
    },
    linkedItemType: "alszam",
    fields: [{ code: "MEGJEGYZES", type: "Text", required: false, default: null }],
  };

  assert.deepEqual(redactSecrets(payload), payload);
});

test("a nem-objektum értékek változatlanok", () => {
  assert.equal(redactSecrets(42), 42);
  assert.equal(redactSecrets(true), true);
  assert.equal(redactSecrets(null), null);
  assert.equal(redactSecrets(undefined), undefined);
  assert.equal(redactSecrets("sima szöveg"), "sima szöveg");
});

test("az érték-minta akkor is fog, ha a kulcs ártatlan", () => {
  const safe = redactSecrets({
    message: `A kérés fejléce: Bearer ${FAKE_TOKEN}`,
    note: `A ${FAKE_TOKEN} lejárt.`,
    appKeyLike: "base64:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo9",
  }) as Record<string, string>;

  assert.equal(safe.message, `A kérés fejléce: Bearer ${REDACTED}`);
  assert.equal(safe.note, `A ${REDACTED} lejárt.`);
  assert.equal(safe.appKeyLike, REDACTED);
});

test("a bejelentett konkrét titok mintától függetlenül kiesik", () => {
  clearSecretValues();
  registerSecretValue("SajatToken-1234567890");
  try {
    const safe = redactSecrets({ echo: "a token: SajatToken-1234567890 vége" }) as { echo: string };
    assert.equal(safe.echo, `a token: ${REDACTED} vége`);
  } finally {
    clearSecretValues();
  }
});

test("a túl rövid bejelentett titok nem redaktál szét ártatlan szöveget", () => {
  clearSecretValues();
  registerSecretValue("abc");
  try {
    assert.equal(redactSecrets("abcdefg"), "abcdefg");
  } finally {
    clearSecretValues();
  }
});

test("a bemenetet nem módosítja, csak másolatot ad", () => {
  const input = { req: { authorization: "Bearer titok" } };
  redactSecrets(input);
  assert.equal(input.req.authorization, "Bearer titok");
});

test("a kétszer hivatkozott objektum nem lesz [CIRCULAR], a kör viszont igen", () => {
  const shared = { name: "közös" };
  assert.deepEqual(redactSecrets({ a: shared, b: shared }), { a: { name: "közös" }, b: { name: "közös" } });

  const cyclic: Record<string, unknown> = { name: "kör" };
  cyclic.self = cyclic;
  assert.deepEqual(redactSecrets(cyclic), { name: "kör", self: "[CIRCULAR]" });
});
