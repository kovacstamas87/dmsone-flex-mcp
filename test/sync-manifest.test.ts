import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(rootDir, "scripts", "sync-manifest.mjs");
const manifestPath = join(rootDir, "manifest.json");

test("sync-manifest kétszer futtatva ugyanazt adja (idempotens)", () => {
  execFileSync("node", [scriptPath]);
  const after1 = readFileSync(manifestPath, "utf8");
  execFileSync("node", [scriptPath]);
  const after2 = readFileSync(manifestPath, "utf8");
  assert.equal(after1, after2);

  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const manifest = JSON.parse(after2);
  assert.equal(manifest.version, pkg.version);
});
