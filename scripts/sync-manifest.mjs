#!/usr/bin/env node
// Egyforrású verzió: a manifest.json "version" mezőjét a package.json-hoz igazítja.
// Idempotens — kétszer futtatva ugyanazt az eredményt adja.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(rootDir, "package.json");
const manifestPath = join(rootDir, "manifest.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const manifestRaw = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);

if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.error(`manifest.json verzió szinkronizálva: ${pkg.version}`);
} else {
  console.error(`manifest.json verzió már egyezik: ${pkg.version}`);
}
