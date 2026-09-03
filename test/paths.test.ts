import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { ensureDirInside, resolveDownloadPath, sanitizeFileName, uniquePath } from "../src/paths.js";

const REJECT_MESSAGE = /savePath csak fájlnév vagy a letöltési könyvtár alatti relatív út lehet/;

describe("sanitizeFileName", () => {
  test("a könyvtár-részt eldobja, csak az utolsó szegmens marad", () => {
    assert.equal(sanitizeFileName("../../evil"), "evil");
    assert.equal(sanitizeFileName("..\\..\\evil.pdf"), "evil.pdf");
    assert.equal(sanitizeFileName("/etc/passwd"), "passwd");
    assert.equal(sanitizeFileName("C:\\Users\\x\\titok.docx"), "titok.docx");
  });

  test("a . és .. és az üres név a tartalékot hozza", () => {
    assert.equal(sanitizeFileName("..", "guid-123"), "guid-123");
    assert.equal(sanitizeFileName(".", "guid-123"), "guid-123");
    assert.equal(sanitizeFileName("", "guid-123"), "guid-123");
    assert.equal(sanitizeFileName(undefined, "guid-123"), "guid-123");
    assert.equal(sanitizeFileName("   ", "guid-123"), "guid-123");
    assert.equal(sanitizeFileName("...", "guid-123"), "guid-123");
  });

  test("a tartalék is tisztul, és ha az is üres, 'attachment' lesz", () => {
    assert.equal(sanitizeFileName("", "../../x"), "x");
    assert.equal(sanitizeFileName("", ".."), "attachment");
    assert.equal(sanitizeFileName(undefined), "attachment");
  });

  test("Windows-fenntartott nevek _ előtagot kapnak, a hasonló nevek nem", () => {
    assert.equal(sanitizeFileName("con.txt"), "_con.txt");
    assert.equal(sanitizeFileName("NUL"), "_NUL");
    assert.equal(sanitizeFileName("com1.log"), "_com1.log");
    assert.equal(sanitizeFileName("LPT9"), "_LPT9");
    assert.equal(sanitizeFileName("console.txt"), "console.txt");
    assert.equal(sanitizeFileName("nullable.pdf"), "nullable.pdf");
  });

  test("shell-szerű és tiltott karakterek _-re cserélődnek, elválasztó nem marad", () => {
    const name = sanitizeFileName('"file.pdf"; rm -rf');
    assert.equal(name, "_file.pdf_; rm -rf");
    assert.ok(!name.includes('"'));
    assert.ok(!name.includes("/") && !name.includes("\\"));

    assert.equal(sanitizeFileName("a<b>c:d|e?f*g.pdf"), "a_b_c_d_e_f_g.pdf");
    assert.equal(sanitizeFileName("a\u0000b\nc\u007fd.pdf"), "a_b_c_d.pdf");
  });

  test("záró pontok és szóközök lekopnak (Windows-viselkedés)", () => {
    assert.equal(sanitizeFileName("evil."), "evil");
    assert.equal(sanitizeFileName("evil...   "), "evil");
    assert.equal(sanitizeFileName("  jelentes.pdf  "), "jelentes.pdf");
  });

  test("200 kódpontra csonkol, a kiterjesztést megtartva", () => {
    const long = `${"a".repeat(300)}.pdf`;
    const name = sanitizeFileName(long);
    assert.equal(Array.from(name).length, 200);
    assert.ok(name.endsWith(".pdf"));

    const noExt = "b".repeat(300);
    assert.equal(sanitizeFileName(noExt).length, 200);

    // Túl hosszú „kiterjesztés" nem kiterjesztés — egyszerűen csonkolunk.
    const fakeExt = `x.${"y".repeat(250)}`;
    assert.equal(Array.from(sanitizeFileName(fakeExt)).length, 200);

    // Többbájtos karakterek nem törnek szét.
    const emoji = "😀".repeat(250);
    const emojiName = sanitizeFileName(emoji);
    assert.equal(Array.from(emojiName).length, 200);
    assert.ok(!emojiName.includes("\uFFFD"));
  });

  test("a valós, ártatlan fájlnevek változatlanok maradnak", () => {
    for (const name of ["Számla_2026 (1).pdf", "jegyzőkönyv-final.docx", ".gitignore", "kép.jpeg", "árvíztűrő tükörfúrógép.txt"]) {
      assert.equal(sanitizeFileName(name), name);
    }
  });

  test("idempotens", () => {
    for (const name of ['"file.pdf"; rm -rf', "../../evil", "con.txt", "a<b>.pdf", "evil...", "Számla.pdf"]) {
      const once = sanitizeFileName(name);
      assert.equal(sanitizeFileName(once), once);
    }
  });
});

describe("resolveDownloadPath", () => {
  const base = path.resolve(path.sep, "sandbox", "dl");
  const inside = (...parts: string[]) => path.join(base, ...parts);

  test("savePath nélkül a szerver adta fájlnév kerül a könyvtárba", () => {
    assert.equal(resolveDownloadPath(base, undefined, "x.pdf"), inside("x.pdf"));
    assert.equal(resolveDownloadPath(base, "", "x.pdf"), inside("x.pdf"));
    assert.equal(resolveDownloadPath(base, "   ", "x.pdf"), inside("x.pdf"));
  });

  test("fájlnév és relatív alkönyvtár engedett", () => {
    assert.equal(resolveDownloadPath(base, "szamla.pdf", "x.pdf"), inside("szamla.pdf"));
    assert.equal(resolveDownloadPath(base, "2026/szamla.pdf", "x.pdf"), inside("2026", "szamla.pdf"));
    assert.equal(resolveDownloadPath(base, "2026\\szamla.pdf", "x.pdf"), inside("2026", "szamla.pdf"));
    assert.equal(resolveDownloadPath(base, "./x.pdf", "x.pdf"), inside("x.pdf"));
  });

  test("a sandboxon belül maradó .. engedett (a/b/../c → a/c)", () => {
    assert.equal(resolveDownloadPath(base, "a/b/../c", "x.pdf"), inside("a", "c"));
    assert.equal(resolveDownloadPath(base, "a/../b.pdf", "x.pdf"), inside("b.pdf"));
  });

  test("/-re végződő savePath könyvtár: a fájlnév kerül alá", () => {
    assert.equal(resolveDownloadPath(base, "proba/", "x.pdf"), inside("proba", "x.pdf"));
    assert.equal(resolveDownloadPath(base, "proba\\", "x.pdf"), inside("proba", "x.pdf"));
    assert.equal(resolveDownloadPath(base, ".", "x.pdf"), inside("x.pdf"));
    assert.equal(resolveDownloadPath(base, "./", "x.pdf"), inside("x.pdf"));
  });

  test("a könyvtár fölé lépő savePath elutasítva", () => {
    for (const bad of ["../x", "..", "../", "..\\x", "a/../../x", "a/b/../../../x", "./../x"]) {
      assert.throws(() => resolveDownloadPath(base, bad, "x.pdf"), REJECT_MESSAGE, `nem utasította el: ${bad}`);
    }
  });

  test("abszolút útvonal bármely platform szabálya szerint elutasítva", () => {
    const bad = [
      "/etc/x",
      "/",
      "C:\\x",
      "C:/x",
      "c:\\Windows\\System32\\x",
      "C:x", // meghajtó-relatív — a win32.isAbsolute nem fogja, mi igen
      "\\\\srv\\share\\x",
      "//srv/share/x",
      "\\x",
      "\\\\?\\C:\\x",
    ];
    for (const p of bad) {
      assert.throws(() => resolveDownloadPath(base, p, "x.pdf"), REJECT_MESSAGE, `nem utasította el: ${p}`);
    }
  });

  test("a savePath szegmensei is tisztulnak", () => {
    assert.equal(resolveDownloadPath(base, "2026/con.txt", "x.pdf"), inside("2026", "_con.txt"));
    assert.equal(resolveDownloadPath(base, "a<b>/c|d.pdf", "x.pdf"), inside("a_b_", "c_d.pdf"));
    assert.equal(resolveDownloadPath(base, "sub/evil.", "x.pdf"), inside("sub", "evil"));
  });

  test("a fileName paraméter is védekezően tisztul", () => {
    assert.equal(resolveDownloadPath(base, undefined, "../../evil"), inside("evil"));
    assert.equal(resolveDownloadPath(base, "proba/", ".."), inside("proba", "attachment"));
  });

  test("minden elfogadott eredmény a könyvtár alatt van", () => {
    const accepted = ["x.pdf", "a/b.pdf", "a/b/../c", "proba/", "./x", "2026\\x.pdf", "a<b>.pdf"];
    for (const p of accepted) {
      const resolved = resolveDownloadPath(base, p, "x.pdf");
      assert.ok(resolved.startsWith(base + path.sep), `${p} → ${resolved} nincs a könyvtár alatt`);
      assert.notEqual(resolved, base);
    }
  });

  test("relatív baseDir-t is abszolúttá tesz", () => {
    const resolved = resolveDownloadPath("rel-dl", undefined, "x.pdf");
    assert.ok(path.isAbsolute(resolved));
    assert.equal(resolved, path.join(path.resolve("rel-dl"), "x.pdf"));
  });
});

describe("ensureDirInside és uniquePath (valódi fájlrendszer)", () => {
  const roots: string[] = [];
  const mkroot = async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "flex-paths-test-"));
    roots.push(dir);
    return dir;
  };
  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  test("ensureDirInside létrehozza az alkönyvtárat a sandboxon belül", async () => {
    const base = await mkroot();
    const target = path.join(base, "sub", "mély", "x.pdf");
    await ensureDirInside(base, target);
    const stat = await fs.stat(path.dirname(target));
    assert.ok(stat.isDirectory());
  });

  test("ensureDirInside akkor is működik, ha maga a könyvtár még nem létezik", async () => {
    const root = await mkroot();
    const base = path.join(root, "még-nincs");
    await ensureDirInside(base, path.join(base, "x.pdf"));
    assert.ok((await fs.stat(base)).isDirectory());
  });

  test("ensureDirInside elutasítja a sandboxból kifelé mutató symlink-alkönyvtárat", async () => {
    const base = await mkroot();
    const outside = await mkroot();
    await fs.symlink(outside, path.join(base, "link"), "dir");

    await assert.rejects(
      ensureDirInside(base, path.join(base, "link", "x.pdf")),
      /letöltési könyvtáron kívülre mutat \(symlink\)/,
    );
    // A kinti könyvtárba nem került semmi.
    assert.deepEqual(await fs.readdir(outside), []);
  });

  test("ensureDirInside a symlinkes temp-gyökeret (macOS /var → /private/var) nem téveszti össze kilépéssel", async () => {
    const base = await mkroot(); // a tmpdir maga lehet symlink — ennek át kell mennie
    await ensureDirInside(base, path.join(base, "x.pdf"));
  });

  test("uniquePath: nem létező fájlnál változatlan, ütközésnél -1, -2… a kiterjesztés előtt", async () => {
    const base = await mkroot();
    const target = path.join(base, "a.pdf");
    assert.equal(await uniquePath(target), target);

    await fs.writeFile(target, "1");
    assert.equal(await uniquePath(target), path.join(base, "a-1.pdf"));

    await fs.writeFile(path.join(base, "a-1.pdf"), "2");
    assert.equal(await uniquePath(target), path.join(base, "a-2.pdf"));
  });

  test("uniquePath kiterjesztés nélküli névnél is utótagot ad", async () => {
    const base = await mkroot();
    const target = path.join(base, "b");
    await fs.writeFile(target, "1");
    assert.equal(await uniquePath(target), path.join(base, "b-1"));
  });

  test("uniquePath a törött symlinket is foglaltnak veszi (az wx írás azon elbukna)", async () => {
    const base = await mkroot();
    const target = path.join(base, "c.pdf");
    await fs.symlink(path.join(base, "nincs-ilyen"), target);
    assert.equal(await uniquePath(target), path.join(base, "c-1.pdf"));
  });

  test("a teljes letöltési lánc: resolve → ensureDir → unique → wx írás nem ír felül", async () => {
    const base = await mkroot();
    const write = async (savePath: string | undefined, content: string) => {
      const target = resolveDownloadPath(base, savePath, "szerver-adta.pdf");
      await ensureDirInside(base, target);
      const finalPath = await uniquePath(target);
      await fs.writeFile(finalPath, content, { flag: "wx" });
      return finalPath;
    };

    const first = await write(undefined, "első");
    const second = await write(undefined, "második");
    assert.equal(first, path.join(base, "szerver-adta.pdf"));
    assert.equal(second, path.join(base, "szerver-adta-1.pdf"));
    assert.equal(await fs.readFile(first, "utf8"), "első", "az első fájl nem íródhat felül");

    const nested = await write("2026/proba/", "harmadik");
    assert.equal(nested, path.join(base, "2026", "proba", "szerver-adta.pdf"));
  });
});
