/**
 * Fájlrendszer-útvonalak biztonságos kezelése a csatolmány-letöltéshez.
 *
 * Miért külön fájl: a `flex_workflow_download_attachment` két, nem megbízható
 * forrásból kap útvonal-darabot — a modelltől (`savePath`) és a Flex szervertől
 * (`Content-Disposition` fájlnév). Mindkettő tartalmazhat `..`-t, abszolút utat,
 * meghajtó-betűt vagy UNC-előtagot, és a korábbi kód ezeket szó szerint fűzte
 * a letöltési könyvtárhoz (P0-3). Itt minden útvonal-döntés egy helyen van,
 * tiszta függvényként, hogy tesztelhető legyen platformtól függetlenül.
 *
 * A szabály egyszerű: **a fájl mindig a letöltési könyvtár alá kerül**, és
 * **meglévő fájlt sosem írunk felül**.
 *
 * Platform-megjegyzés: a függvények szándékosan a `path.posix` **és** a
 * `path.win32` szabályait is alkalmazzák, futó platformtól függetlenül. Egy
 * macOS-en futó szerver számára a `C:\x` csak egy furcsa fájlnév lenne, de a
 * modell által adott útvonal egy Windowson futó példánynál ugyanez a bemenet
 * abszolút út — ugyanannak a szabálynak kell fognia mindkét helyen, hogy a
 * viselkedés kiszámítható legyen.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Ha semmi értelmes nem marad a névből, ez a végső tartalék. */
const LAST_RESORT_NAME = "attachment";

/** A név legnagyobb hossza kódpontban — a legtöbb fájlrendszer 255 bájtos korlátja alatt marad UTF-8-ban is. */
const MAX_NAME_LENGTH = 200;

/** Ennél hosszabb „kiterjesztést" nem tekintünk kiterjesztésnek csonkoláskor. */
const MAX_EXT_LENGTH = 20;

/** Windows-fenntartott eszköznevek — kiterjesztéssel együtt is (`con.txt`) fenntartottak. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;

/** Vezérlőkarakterek és a Windowson tiltott jelek; a `/` és `\` a basename miatt már nem lehet benne. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f<>:"|?*]/g;

/** Egyetlen útvonal-szegmens megtisztítása; üres eredménynél `""`-t ad (a hívó dönt a tartalékról). */
function cleanSegment(raw: string): string {
  // A `\`-t is elválasztónak vesszük: egy Windowsról jövő fájlnév `a\b.pdf` alakban
  // is jöhet, és a `basename` csak a saját platform elválasztóját ismeri.
  let name = path.posix.basename(raw.replace(/\\/g, "/"));
  name = name.replace(FORBIDDEN_CHARS, "_");
  // A Windows a záró pontokat és szóközöket eldobja — `evil.` így `evil` lenne;
  // a `.` és `..` pedig ettől üressé válik, ami a tartalék nevet hozza.
  name = name.replace(/[. ]+$/, "").trim();
  if (name === "") return "";

  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;

  const chars = Array.from(name);
  if (chars.length > MAX_NAME_LENGTH) {
    const ext = path.posix.extname(name);
    const keepExt = ext.length > 0 && ext.length <= MAX_EXT_LENGTH ? ext : "";
    const stem = Array.from(name.slice(0, name.length - keepExt.length));
    name = stem.slice(0, MAX_NAME_LENGTH - Array.from(keepExt).length).join("") + keepExt;
  }
  return name;
}

/**
 * Nem megbízható fájlnévből biztonságos, könyvtár nélküli fájlnevet készít.
 *
 * - `\` → `/`, majd csak az utolsó szegmens marad (`../../evil` → `evil`);
 * - vezérlő- és `<>:"|?*` karakterek → `_`;
 * - `.`, `..`, üres vagy csak szóköz/pont → `fallback` (az is megtisztítva);
 * - Windows-fenntartott nevek (`con`, `nul`, `com1`…) elé `_`;
 * - legfeljebb 200 kódpont, a kiterjesztés megtartásával.
 *
 * A `fallback` sem megbízható (a letöltésnél az attachmentGuid, ami modell-bemenet),
 * ezért ugyanazon a tisztításon megy át; ha az is üres, `attachment` lesz.
 */
export function sanitizeFileName(name: string | undefined, fallback: string = LAST_RESORT_NAME): string {
  return cleanSegment(name ?? "") || cleanSegment(fallback) || LAST_RESORT_NAME;
}

/** Igaz, ha az útvonal bármely platform szabályai szerint abszolút (POSIX `/…`, Windows `C:\…`, `\\srv\…`, `\x`). */
function isAbsoluteAnywhere(p: string): boolean {
  return path.posix.isAbsolute(p) || path.win32.isAbsolute(p);
}

/**
 * A `savePath`-ot a letöltési könyvtár alá oldja fel, vagy hibát dob.
 *
 * Elutasítva: abszolút út (POSIX vagy Windows szabály szerint), meghajtó-relatív
 * út (`C:x`), és minden olyan út, ami normalizálás után a könyvtár fölé lépne
 * (`../x`, `a/../../x`). Engedett: fájlnév, relatív alkönyvtár (`2026/x.pdf`),
 * és a sandboxon belül maradó `..` (`a/b/../c` → `a/c`). A `/`-re végződő
 * `savePath` könyvtárat jelent: a szerver adta `fileName` kerül alá.
 *
 * A szegmensek a `sanitizeFileName` szabályai szerint tisztulnak (tiltott
 * karakterek `_`, fenntartott nevek `_` előtaggal) — a visszaadott `filePath`
 * úgyis megmutatja a végleges nevet, meglepetés nincs.
 *
 * A végén prefix-ellenőrzés is fut: ez a védvonal akkor is fog, ha a fenti
 * szabályok valamelyike kimaradna (defense in depth, nem redundancia).
 *
 * @param baseDir  a letöltési könyvtár — abszolút útvonal (a hívó `path.resolve`-olja)
 * @param savePath a modelltől kapott cél, opcionális
 * @param fileName biztonságos fájlnév (már `sanitizeFileName`-en átment); tartalék, ha nincs `savePath`
 */
export function resolveDownloadPath(baseDir: string, savePath: string | undefined, fileName: string): string {
  const base = path.resolve(baseDir);
  // Védekező újratisztítás: idempotens, és így a függvény önmagában is biztonságos.
  const leaf = sanitizeFileName(fileName);
  const raw = (savePath ?? "").trim();

  if (raw === "") return path.join(base, leaf);

  const normalizedSeparators = raw.replace(/\\/g, "/");
  if (isAbsoluteAnywhere(raw) || isAbsoluteAnywhere(normalizedSeparators) || /^[A-Za-z]:/.test(raw)) {
    throw new Error(
      `A savePath ("${raw}") abszolút útvonal. ` +
        "A savePath csak fájlnév vagy a letöltési könyvtár alatti relatív út lehet.",
    );
  }

  const wantsDirectory = normalizedSeparators.endsWith("/");
  const segments: string[] = [];
  for (const segment of normalizedSeparators.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        throw new Error(
          `A savePath ("${raw}") a letöltési könyvtár fölé mutat. ` +
            "A savePath csak fájlnév vagy a letöltési könyvtár alatti relatív út lehet.",
        );
      }
      segments.pop();
      continue;
    }
    segments.push(sanitizeFileName(segment, "_"));
  }

  if (wantsDirectory || segments.length === 0) segments.push(leaf);

  const resolved = path.resolve(base, ...segments);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    // Ide elvileg nem jutunk el; ha mégis, az a fenti szabályok hibája — akkor is tiltunk.
    throw new Error(
      `A savePath ("${raw}") a letöltési könyvtáron kívülre mutat. ` +
        "A savePath csak fájlnév vagy a letöltési könyvtár alatti relatív út lehet.",
    );
  }
  if (resolved === base) {
    throw new Error("A savePath nem lehet maga a letöltési könyvtár; adj meg fájlnevet is.");
  }
  return resolved;
}

/**
 * Létrehozza a célfájl szülőkönyvtárát a sandboxon belül, és ellenőrzi, hogy a
 * **valódi** (symlink-feloldott) könyvtár is a letöltési könyvtár alatt van.
 *
 * Miért kell a realpath: a `resolveDownloadPath` szöveges útvonalakkal dolgozik.
 * Ha a letöltési könyvtárban egy alkönyvtár symlink, ami kifelé mutat, a szöveges
 * ellenőrzés átmegy, az írás mégis a sandboxon kívülre kerülne. macOS-en ráadásul
 * maga a temp könyvtár is symlink (`/var/…` → `/private/var/…`), ezért mindkét
 * oldalt fel kell oldani, nem csak a célt.
 */
export async function ensureDirInside(baseDir: string, filePath: string): Promise<void> {
  const base = path.resolve(baseDir);
  const dir = path.dirname(path.resolve(filePath));

  await fs.mkdir(base, { recursive: true });
  await fs.mkdir(dir, { recursive: true });

  const [realBase, realDir] = await Promise.all([fs.realpath(base), fs.realpath(dir)]);
  if (realDir !== realBase && !realDir.startsWith(realBase + path.sep)) {
    throw new Error(
      `A célkönyvtár ("${dir}") a letöltési könyvtáron kívülre mutat (symlink). ` +
        "A letöltés csak a letöltési könyvtár alá írhat.",
    );
  }
}

/** Ennyi ütközés után feladjuk — ennyi azonos nevű fájl már nem véletlen. */
const MAX_UNIQUE_ATTEMPTS = 1000;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p); // lstat: a törött symlink is „létezik" — az `wx` írás azon is elbukna
    return true;
  } catch {
    return false;
  }
}

/**
 * Ha a fájl már létezik, `-1`, `-2`… utótagot fűz a névhez (a kiterjesztés előtt):
 * `a.pdf` → `a-1.pdf` → `a-2.pdf`. Nem létező fájlnál változatlanul adja vissza.
 *
 * Ez csak a *várható* ütközést kerüli el; a versenyhelyzetet (két letöltés
 * egyszerre) az írás `wx` flagje zárja le — ott EEXIST hibát kapunk, nem felülírást.
 */
export async function uniquePath(filePath: string): Promise<string> {
  if (!(await exists(filePath))) return filePath;

  const { dir, name, ext } = path.parse(filePath);
  for (let i = 1; i <= MAX_UNIQUE_ATTEMPTS; i++) {
    const candidate = path.join(dir, `${name}-${i}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Nem sikerült egyedi fájlnevet találni a(z) "${filePath}" mellé.`);
}
