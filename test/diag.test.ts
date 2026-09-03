import { test } from "node:test";
import assert from "node:assert/strict";

import { pickDiagFields } from "../src/tools/diagnostic.js";

test("a diag-válaszból csak az ok/method/uri/qs marad", () => {
  const picked = pickDiagFields({
    success: true,
    result: {
      method: "GET",
      uri: "/api/diag",
      qs: { greeting: "szia" },
      req: { Authorization: "Bearer mvp_0123456789abcdefghijklmnop" },
      cookies: { flex_session: "abc" },
      server: { APP_KEY: "base64:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo9" },
    },
  });

  assert.deepEqual(picked, { ok: true, method: "GET", uri: "/api/diag", qs: { greeting: "szia" } });
});

test("a gyökérben álló mezőket is elfogadja (burkoló nélküli alak)", () => {
  assert.deepEqual(pickDiagFields({ method: "GET", uri: "/api/diag", req: { cookie: "a=1" } }), {
    ok: true,
    method: "GET",
    uri: "/api/diag",
  });
});

test("ismeretlen alaknál is ok:true a válasz", () => {
  assert.deepEqual(pickDiagFields({ valami: "más" }), { ok: true });
  assert.deepEqual(pickDiagFields("szöveg"), { ok: true });
  assert.deepEqual(pickDiagFields(null), { ok: true });
});
