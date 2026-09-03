import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(rootDir, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));

/**
 * A manifest a Claude Desktop **telepítési** szerződése: a `tools` tömböt a
 * `sync-manifest` őrzi (lásd `sync-manifest.test.ts`), az itt tesztelt részt
 * viszont ember írja, és a hibája csak a telepítéskor derülne ki.
 */
describe("manifest.json", () => {
  test("manifest_version 0.3 — a metaadat-hivatkozásokat ez a séma ismeri", () => {
    assert.equal(manifest.manifest_version, "0.3");
  });

  test("minden mcp_config env-hivatkozás létező user_config kulcsra mutat", () => {
    // Egy elírt kulcs a Claude Desktopban üres env-változó lesz: a szerver
    // csendben alapértelmezéssel indul, és a felhasználó beállítása elveszik.
    const keys = Object.keys(manifest.user_config);
    for (const [name, value] of Object.entries<string>(manifest.server.mcp_config.env)) {
      const match = /^\$\{user_config\.([a-z0-9_]+)\}$/.exec(value);
      assert.ok(match, `${name} értéke nem user_config-hivatkozás: ${value}`);
      assert.ok(keys.includes(match[1]), `${name} → nincs ilyen user_config: ${match[1]}`);
    }
  });

  test("a hivatkozott URL-ek a valódi repóra mutatnak, nem sablonra", () => {
    const repo = "https://github.com/kovacstamas87/dmsone-flex-mcp";
    assert.equal(manifest.homepage, repo);
    assert.equal(manifest.support, `${repo}/issues`);
    assert.equal(manifest.author.url, repo);
    assert.equal(manifest.repository.url, `${repo}.git`);
    assert.match(manifest.documentation, new RegExp(`^${repo}/blob/main/`));
  });

  test("a verzió a package.json-nal egy forrásból jön", () => {
    assert.equal(manifest.version, pkg.version);
  });
});
