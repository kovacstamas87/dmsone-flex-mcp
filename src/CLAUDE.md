# src — a Flex MCP szerver forráskódja

TypeScript forrás, `tsc`-vel fordítva `dist/`-be (`npm run build`). Belépési pont: `index.ts`.

## Fájl-leltár

| Fájl | Mi ez |
|---|---|
| `index.ts` | Belépési pont: konfiguráció betöltése, `McpServer` létrehozása (stdio transzport), a négy `register*Tools` hívása. A szerver-szintű `SERVER_INSTRUCTIONS` (magyar, a modellnek szóló "térkép") is itt van. A `version` mezőt a `package.json`-ból olvassa (`createRequire`) — lásd [`../CLAUDE.md`](../CLAUDE.md) „Kulcsdöntések". |
| `config.ts` | `loadConfig()` — env változókból (`FLEX_*`) épít `FlexConfig`-ot; a `truthy()` helper a boolean env-parsinghoz. A `downloadDir` **abszolút** (`path.resolve`), mert ez a letöltés sandbox-határa. A `timeZone` (`FLEX_TIMEZONE`, alap `DEFAULT_TIME_ZONE` = `Europe/Budapest`) IANA zónanév; a `resolveTimeZone()` **induláskor egyszer** validálja az `Intl`-lel, és elírás esetén stderr-figyelmeztetéssel visszaesik az alapértelmezettre. `validateConfig(config)` — üres token, publikus URL-en kikapcsolt SSL → hiba; fejlesztői URL-en kikapcsolt SSL, PAT+impersonáció → figyelmeztetés; nem lép ki és nem ír stderr-re, ezt a hívó (`index.ts`) dönti el. |
| `paths.ts` | A letöltés útvonal-logikája, tiszta függvényekben: `sanitizeFileName` (szerver-fájlnév és GUID tisztítása), `resolveDownloadPath` (a `savePath` feloldása a letöltési könyvtár alá, vagy hiba), `ensureDirInside` (szülőkönyvtár létrehozása + `realpath`-ellenőrzés symlink ellen), `uniquePath` (`-1`, `-2`… utótag). A fejkomment írja le, miért mindkét platform (posix **és** win32) szabályait alkalmazza. |
| `client.ts` | `FlexClient` — axios-alapú HTTP kliens a Flex API-hoz (auth fejlécek, base URL, SSL-figyelmen-kívül-hagyás). |
| `format.ts` | `toolJson` / `toolError` / `formatError` — minden tool eredménye ezen megy át; a hibaüzenetek magyarul, HTTP-státusz szerint kategorizálva. A `toolJson` **redaktál, majd szerializál** (a `text` és a `structuredContent` így ugyanazt látja), és az 50 000 karakteres korlát fölött **mindkét csatornát** csonkolja (a `structuredContent` helyére `{ truncated, originalChars, note }` kerül); a `formatError` a hibatörzset redaktálja és 2 000 karakterre csonkolja. `formatDateTime(value, timeZone)` a Flex `YYYY-MM-DD HH:mm:ss` alakjára hoz — falióra-szemantikával, lásd „Kulcsdöntések". |
| `projection.ts` | A két listázó eszköz lista-projekciója és lapozása: `summarizeTask` (`/dms/news` elem — **WF11-től** `idKind: "taskId" \| "wfTaskId"` is, a `type`-ból származtatva), `summarizeWfTask` (`/dms/wfTasks/my` elem), `paginate(items, offset, limit)` és `envelope(payload, options, summarize)`. A fejkomment mérésekkel írja le, **mi és miért** marad ki a summary-ből. |
| `schema.ts` | A szerver által épített válaszok `outputSchema`-i (`diagOutput`, `templateDetailsOutput`, `downloadOutput`, `taskListOutput`, `wfTaskListOutput`). A `looseOutput(shape)` helper minden mezőt opcionálissá tesz, hozzáadja a csonkolás-ág (`truncated`/`originalChars`/`note`) mezőit, és `passthrough()`-ol. A fejkomment írja le, miért **laza** a séma és miért csak öt eszközön van. |
| `redact.ts` | `redactSecrets()` — rekurzív titok-szűrő kulcs- és érték-minták alapján; `registerSecretValue()` a konfigurált token literális bejelentésére. A fejkomment írja le a mintákat és a (jelenleg üres) kivétel-listát. |
| `tools/` | A 19 MCP tool regisztrációja, erőforrásonként — lásd lent. |

## `tools/`

A 19 eszköz regisztrációja négy fájlban, erőforrásonként — a fájl-leltár, a **Task ≠ WfTask**
elhatárolás és az eszközírás rögzített szabályai (`toolJson`-kötelezettség, leírás-őszinteség,
annotációk, dátumkezelés) a saját mappa-doksijában: [`tools/CLAUDE.md`](tools/CLAUDE.md).

## Kulcsdöntések

- **A Flex dátumai falióra-idők, nem időpillanatok** — ezért a `formatDateTime` offset nélküli
  bemenetet **változatlanul** hagy (csak normalizál), és csak az offsettel megadott értéket
  számolja át a `FLEX_TIMEZONE` zónájára (`Intl.DateTimeFormat` + `formatToParts`, `hourCycle: "h23"`).
  Miért nem `toISOString()`, ahogy korábban: az mindig UTC-re konvertált, így egy nyári
  `…T23:59:59+02:00` határidő két órával korábbra, `21:59:59`-ként ment be a Flexbe (P0-5).
  Külön időzóna-könyvtár (`date-fns-tz`) nem kell: a Node 20 full-ICU build ezt tudja.
- **A mintára illő, de nem létező dátum (`2026-13-45`, `2026-02-30`) változatlanul megy vissza**,
  nem alakul át. Miért: egy elírásból nem szabad hihető kinézetű, de hamis értéket küldeni a
  Flexbe — így a felhasználó a Flex saját hibaüzenetét kapja, ahogy a javítás előtt is.
- **A kötelezőség-validáció csak akkor fut, ha az API egyáltalán jelöl kötelezőséget**
  (`parseTemplateFields` → `requiredMarkerPresent`). Miért: a 66-os sablon mezőin nincs
  `required`/`mandatory` kulcs, csak `visibility: MT_K`/`MT_M` — a régi kód ezt `required: false`-ra
  fordította, így az ellenőrzés mindent átengedett, miközben a leírás azt ígérte, hogy ellenőriz.
  Most a `describeTemplate` a `validation: "api-flag" | "none"` mezőben (és `"none"` esetén egy
  `note`-ban) kimondja, mit tudunk, a `flex_workflow_start` pedig nyíltan best-effort. A jelölés
  **jelenléte** számít, nem az értéke: csupa `required: false` az API-tól érdemi információ, a kulcs
  hiánya viszont nem. A Flex-oldali kérdés (mi jelöli a kötelezőséget) a P0-6 nyitott fele.

- **A listázás alapból összefoglalót ad, nem teljes adatot.** A `/dms/news` egyetlen hívása a
  fejlesztői rendszeren 21 elemre **70 645 karaktert** adott vissza, ennek 83%-a olyan mező
  (`metaItems`, `attachments`, `comments`, HTML leírások), amihez külön részletező eszköz van;
  a `summarizeTask` ezeket elhagyva ugyanez **7 312 karakter** (11,6%). Miért projekció és nem
  csak csonkolás: a csonkolás a lista **közepén** vágna el, így a modell nem tudná, mi maradt ki;
  a projekció minden elemet meghagy, csak soványabban, és a `hasMore` kimondja, ha van folytatás.
  A kommentek és csatolmányok **darabszámmal** maradnak benne (`commentCount`, `attachmentCount`),
  hogy látszódjon, érdemes-e megnyitni az elemet.
- **`outputSchema` csak a szerver által épített válaszokon van, és szándékosan laza.** Az SDK a
  `structuredContent`-et **validálja** a sémára, és hibára az egész tool-hívás `InvalidParams`-szal
  elszáll — a modell nem a Flex adatát kapja, hanem protokollhibát. Ezért (1) a Flex válaszát
  változatlanul továbbadó eszközökön nincs séma (az ő alakjukra nincs szerződésünk), (2) a
  meglévő öt sémában minden mező opcionális és `passthrough()` van, mert három valós ág más
  alakot ad: a `toolJson` csonkolása, a listázók nem-tömb `result`-ra vett fallbackje, és maga a
  Flex, ha egy mező máshogy jön. A séma haszna így nem az őrzés, hanem hogy a modell a
  `tools/list`-ben **látja a válasz kulcsait** — ez tette lehetővé a leírások rövidítését (WF10).
- **A `toolJson` méretkorlátja védőháló, nem az elsődleges eszköz.** Az elsődleges a kérés oldalán
  ható `limit`/`fields`; a csonkolás akkor lép be, ha valami mégis átcsúszna. Korábban csak a
  `text` csonkolódott, a `structuredContent` teljes egészében ment — ez a P1-4 hibája volt, mert a
  kliens azt is a modell elé teszi.
- **Váratlan válaszalak esetén a nyers payload megy tovább.** Ha a Flex `result`-ja nem tömb, az
  `envelope` `undefined`-et ad, és a hívó a nyers választ küldi el. Miért: egy alakváltozásnál
  rosszabb csendben elrejteni az adatot, mint kihagyni a lapozást.
- **Minden tool-válasz a `format.ts` `toolJson`/`toolError`-én át megy** — ez a titok-redakció
  egyetlen beépítési pontja, a `tools/*.ts` fájloknak nem kell egyedileg foglalkozniuk vele.
  A `test/format.test.ts` egy forrás-szintű teszttel őrzi, hogy ne keletkezzen kézzel összeállított
  tool-eredmény a `tools/` alatt (az lenne az egyetlen módja megkerülni a szűrőt).
- **A redakció kulcs- és érték-alapú is, szándékosan átfedve.** A kulcs-minta akkor is fog, ha a
  token formátuma változik; az érték-minta akkor is, ha a backend váratlan nevű mezőbe teszi. Ehhez
  jön harmadikként a konfigurált token literális bejelentése (`registerSecretValue` az `index.ts`-ben):
  ez akkor is kiszűri a saját tokenünket, ha egyik mintára sem illik.
- **A `flex_diag` nem redakcióra támaszkodik, hanem mezőválogatásra.** A `/diag` a `req`, `cookies`
  és `server` blokkokban visszatükrözi a Bearer tokent és a backend env-et — ezek fel sem kerülnek
  a válaszba. A redakció a második védvonal, nem az első.
- **A letöltés útvonala három lépcsőben dől el, mind a `paths.ts`-ben:** (1) szöveges szabályok —
  abszolút út (posix vagy win32 szerint), meghajtó-betű, UNC és a könyvtár fölé lépő `..` tiltott,
  a sandboxon belül maradó `..` (`a/b/../c`) engedett; (2) prefix-ellenőrzés a feloldott útvonalon
  (akkor is fog, ha az (1) valamelyik szabálya kimaradna); (3) `realpath`-ellenőrzés a szülőkönyvtáron
  (`ensureDirInside`), mert a szöveges ellenőrzés a kifelé mutató symlink-alkönyvtárat átengedné.
  Miért mindkét platform szabálya: a szerver macOS-en és Windowson is fut, és a modell ugyanazt a
  `savePath`-ot adja mindkettőn — a viselkedésnek egyformának kell lennie.
- **A `savePath` szegmensei és a szerver fájlneve ugyanazon a tisztításon mennek át**
  (`sanitizeFileName`): tiltott karakterek `_`, záró pontok/szóközök le, Windows-fenntartott nevek
  `_` előtag, 200 kódpont. A GUID is tisztul, mert az is modell-bemenet, és tartalék fájlnévként
  szolgál. A végleges nevet a válasz `filePath`/`fileName` mezője úgyis megmutatja.
- **Felülírás sosem:** `uniquePath` + `writeFile(..., { flag: "wx" })`. Az elsőt a *várható*
  ütközés kerülésére, a másodikat a versenyhelyzet ellen — ezért a letöltés `destructiveHint: false`
  maradhat, miközben `readOnlyHint: false` és `idempotentHint: false`.
