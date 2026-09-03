#!/usr/bin/env node
/**
 * A `.mcpb` telepítőcsomag előállítása **egyfájlos bundle-ből**.
 *
 * Miért nem `npm install --omit=dev` a staging mappában (a v0.1.1-ig ez volt):
 * a `node_modules` a csomag méretének ~95%-át adta (3,7 MB), és minden benne
 * lévő tranzitív függőség (`.md`, teszt, `.map`, több platformra fordított
 * bináris) a felhasználó gépére került. Az esbuild csak a tényleg elért kódot
 * hozza át egyetlen fájlba, `node_modules` nélkül.
 *
 * Amit a bundle **nem** húz be: a `node:*` beépített modulok (a `platform:
 * "node"` külsőként kezeli őket). Ezért a csomag továbbra is tiszta JavaScript,
 * natív bináris nélkül, és platformfüggetlen.
 *
 * A verzió **egy forrásból** jön: az `src/index.ts` `createRequire`-rel olvassa
 * a csomag gyökerén álló `package.json`-t, ezért a staging mappába egy minimális
 * `package.json` kerül (`dependencies` nélkül — nincs mit telepíteni). A
 * `"type": "module"` ott kötelező: enélkül a Node CommonJS-ként próbálná
 * betölteni az ESM bundle-t.
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(rootDir, "build", "pkg");
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));

/**
 * A csomagba kerülő járulékos fájlok. A `dist/` és a `package.json` külön készül.
 *
 * `.env.example` szándékosan nincs itt: a `@anthropic-ai/mcpb` beépített
 * kizárásai minden `.env*` fájlt eldobnak, és a `.mcpb`-s telepítésnél a
 * beállítás a Claude Desktop űrlapján történik, nem `.env` fájlból.
 */
const COPIED = [
  "manifest.json",
  "icon.png",
  "LICENSE",
  "README.md",
  "INSTALL-WINDOWS.md",
  "INSTALL-MACOS.md",
];

rmSync(join(rootDir, "build"), { recursive: true, force: true });
mkdirSync(join(pkgDir, "dist"), { recursive: true });

await build({
  entryPoints: [join(rootDir, "dist", "index.js")],
  outfile: join(pkgDir, "dist", "index.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: true,
  // A hibaüzenetek és a stack trace olvasható marad a minifikálás után is —
  // egy támogatási kérdésnél ez az egyetlen fogódzó.
  keepNames: true,
  legalComments: "none",
  // Az ESM bundle-be bekerülhet CJS-ként írt függőség, ami `require`-t,
  // `__filename`-t vagy `__dirname`-t vár. ESM-ben ezek nem léteznek, ezért
  // a banner odaadja őket. (A saját kódunk `createRequire`-t használ, az
  // esbuild ezt változatlanul hagyja.)
  banner: {
    js: [
      'import { createRequire as __mcpbCreateRequire } from "node:module";',
      'import { dirname as __mcpbDirname } from "node:path";',
      'import { fileURLToPath as __mcpbFileURLToPath } from "node:url";',
      "const require = __mcpbCreateRequire(import.meta.url);",
      "const __filename = __mcpbFileURLToPath(import.meta.url);",
      "const __dirname = __mcpbDirname(__filename);",
    ].join("\n"),
  },
});

// Minimális package.json: csak amit a Node és az `index.ts` verzióolvasása kér.
// `dependencies` szándékosan nincs — a bundle önhordó, telepíteni nincs mit.
writeFileSync(
  join(pkgDir, "package.json"),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      type: "module",
      main: "dist/index.js",
      license: pkg.license,
      author: pkg.author,
      engines: pkg.engines,
    },
    null,
    2,
  )}\n`,
);

for (const file of COPIED) copyFileSync(join(rootDir, file), join(pkgDir, file));

const mcpbName = `dmsone-flex-${pkg.version}.mcpb`;
execFileSync("npx", ["-y", "@anthropic-ai/mcpb", "pack", pkgDir, mcpbName], {
  cwd: rootDir,
  stdio: "inherit",
});

// Ellenőrzés, nem csak jelentés: ha a `node_modules` bármiért mégis bekerül,
// a build essen el itt, ne a felhasználó gépén derüljön ki.
const listing = execFileSync("unzip", ["-l", mcpbName], { cwd: rootDir, encoding: "utf8" });
if (/\bnode_modules\//.test(listing)) {
  console.error("HIBA: a .mcpb node_modules bejegyzést tartalmaz — a bundle nem önhordó.");
  process.exit(1);
}

const bytes = statSync(join(rootDir, mcpbName)).size;
const bundleBytes = statSync(join(pkgDir, "dist", "index.js")).size;
console.error(
  `${mcpbName} kész: ${(bytes / 1024).toFixed(0)} kB csomag, ` +
    `${(bundleBytes / 1024).toFixed(0)} kB egyfájlos bundle, node_modules nélkül.`,
);
