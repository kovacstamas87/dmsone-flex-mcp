import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(rootDir, "scripts", "sync-manifest.mjs");
const manifestPath = join(rootDir, "manifest.json");

type ManifestTool = { name: string; description: string };

/**
 * A szkript a **lefordított** szerverből olvassa a tool-listát, ezért a teszt
 * előbb fordít. Miért nem elég a forrás: a manifest arról a szerverről tesz
 * ígéretet, ami a csomagba kerül — a build része a mérésnek.
 */
before(
  () => {
    execFileSync("npm", ["run", "build"], { cwd: rootDir, stdio: "ignore" });
  },
  { timeout: 120_000 },
);

function readManifest(): { version: string; tools: ManifestTool[] } {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

describe("sync-manifest", () => {
  test("kétszer futtatva ugyanazt adja (idempotens), és a verzió egyezik", () => {
    execFileSync("node", [scriptPath], { cwd: rootDir, stdio: "ignore" });
    const after1 = readFileSync(manifestPath, "utf8");
    execFileSync("node", [scriptPath], { cwd: rootDir, stdio: "ignore" });
    const after2 = readFileSync(manifestPath, "utf8");
    assert.equal(after1, after2);

    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
    assert.equal(JSON.parse(after2).version, pkg.version);
  });

  /**
   * WF10: a `manifest.tools` **generált**, nem kézzel írt. Ez az őr azt fogja
   * meg, ha a manifest olyan eszközt ígér, amit a szerver nem regisztrál (vagy
   * fordítva) — korábban a két lista szinkron-őr nélkül duplikálta egymást.
   */
  test(
    "a manifest tools tömbje a lefordított szerver tools/list-jével egyezik",
    { timeout: 30_000 },
    async () => {
      execFileSync("node", [scriptPath], { cwd: rootDir, stdio: "ignore" });

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["dist/index.js"],
        cwd: rootDir,
        env: { ...(process.env as Record<string, string>), FLEX_TOKEN: "dummy-token-for-manifest-test" },
        stderr: "ignore",
      });
      const client = new Client({ name: "manifest-test", version: "0.0.0" });
      await client.connect(transport);
      const { tools } = await client.listTools();
      await client.close();

      const manifest = readManifest();
      assert.deepEqual(
        manifest.tools.map((tool) => tool.name),
        tools.map((tool) => tool.name),
        "a manifest és a kód tool-listája eltér",
      );

      for (const tool of manifest.tools) {
        assert.ok(tool.description.length > 0, `${tool.name}: üres leírás`);
        // A manifest-leírás az első mondat, nem a teljes leírás — a felületre való.
        assert.ok(tool.description.length < 200, `${tool.name}: túl hosszú manifest-leírás`);
        assert.ok(!tool.description.includes("\n"), `${tool.name}: a leírás többsoros`);
      }
    },
  );
});
