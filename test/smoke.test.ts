import { test } from "node:test";
import assert from "node:assert/strict";

import { formatError } from "../src/format.js";

test("formatError egy Error-ra 'Hiba: ...'-t ad", () => {
  const result = formatError(new Error("teszt"));
  assert.equal(result, "Hiba: teszt");
});
