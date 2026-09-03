# Flex — DMS One Flex REST API MCP szervere

Lokálisan (stdio) futó, TypeScript MCP szerver, amit a Claude Desktop indít alfolyamatként. A
DMS One Flex REST API-t teszi elérhetővé feladatok, munkafolyamatok és felhasználók kezelésére —
minden hívás a beállított token tulajdonosának a nevében fut. Ugyanazokat a végpontokat fedi, mint
a közösségi `n8n-nodes-dmsone-flex` node.

**Állapot (2026-09-03):** **v0.1.1** kiadva (P0: WF1–WF7), a `../flex-mcp-p1-p2-megvalositasi-terv.md`
**P1 üteme fut**: a **WF9** (payload-kontroll), a **WF10** (`outputSchema`, tömör leírások,
generált `manifest.tools`) és a **WF11** (Task/WfTask `idKind`, `orgId` alapértelmezés kivezetése)
kész — a két listázó lapoz és összefoglalót ad, a `toolJson` a `structuredContent`-et is csonkolja,
öt eszköz `outputSchema`-t ad, az összleírás 11 936-ról 4 500 alá fogyott, a `flex_task_list` minden
eleme explicit `idKind`-ot (`taskId`/`wfTaskId`) is ad, és a `performerOrgId`/`responsibleOrgId`-nak
nincs többé néma `1` alapértelmezése. Build és teszt zöld (132 teszt). A következő a **WF12**
(minőség-infrastruktúra: eslint, prettier, CI, dependabot, handler-tesztek).
Nyitva maradt a Flex-oldali P0-2 elküldése, a P0-6 Flex-válasz és az opcionális élő/írás-tesztek —
lásd lent.

## Mappa tartalma

| Fájl / mappa | Mi ez | Állapot |
|---|---|---|
| [`src/`](src/) | A szerver forráskódja — lásd [`src/CLAUDE.md`](src/CLAUDE.md) | WF10 után (`paths.ts` új WF3-ban, `validateConfig` új WF5-ben, `projection.ts` új WF9-ben, `schema.ts` új WF10-ben) |
| [`test/`](test/) | `node:test` alapú tesztek, `tsx`-szel futtatva (`npm test`) — lásd [`test/CLAUDE.md`](test/CLAUDE.md) | új WF1-ben, WF2–WF5-ben, WF9-ben és WF10-ben bővítve (129 teszt); a `test/fixtures/` élő, **anonimizált** minta |
| [`scripts/sync-manifest.mjs`](scripts/sync-manifest.mjs) | A `manifest.json`-t a kódhoz igazítja, idempotens: a `version` a `package.json`-ból, a `tools[]` a **lefordított** `dist/index.js` `tools/list` válaszából. `dist/` hiányában a `tools`-t érintetlenül hagyja és figyelmeztet | **új WF1-ben**; WF10: `tools[]`-generálás |
| `manifest.json` | `.mcpb` csomag metaadata — a `version` **és WF10-től a `tools[]` is generált**, ne szerkeszd kézzel (a `sync-manifest.mjs` írja) | WF1-ben szinkron-forrás lett; WF3: `flex_download_dir` leírása a sandboxot mondja; WF4: új `flex_timezone` konfig-mező; WF10: generált `tools[]` |
| `package.json` / `package-lock.json` | Függőségek, scriptek (`build`, `test`, `bundle`, `sync-manifest`, `version` lifecycle) | WF1-ben frissítve; WF10: új `sync-manifest` script, és a `bundle` **build után** szinkronizál |
| `INSTALL-WINDOWS.md`, `INSTALL-MACOS.md` | Végfelhasználói telepítési útmutatók | WF1-ben Node 20+ -ra igazítva; WF3: letöltési könyvtár leírása; WF4: „Időzóna" mező a konfig-űrlapon; WF5: SSL-tiltás a publikus URL-en |
| `README.md` | Fejlesztői doksi | WF3: `FLEX_DOWNLOAD_DIR`, WF4: `FLEX_TIMEZONE`, WF5: SSL-tiltás megjegyzése a konfig-táblában |
| `CHANGELOG.md` | Kiadási napló | **WF6-ban megírva** a `[0.1.1]` bejegyzés (Security/Fixed/Changed, P0-hivatkozásokkal) |
| `.env.example` | Env változók mintája (`FLEX_TOKEN`, `FLEX_BASE_URL`, …) | WF3: `FLEX_DOWNLOAD_DIR` megjegyzés (abszolút út, sandbox); WF4: `FLEX_TIMEZONE` |
| `dist/`, `build/`, `*.mcpb`, `node_modules/` | **Build-artefaktum** — ne szerkeszd, `npm run build` / `npm run bundle` állítja elő | generált |

## Hol van az igazság forrása

| Mi | Hol |
|---|---|
| Szerver **verziója** (futásidőben, `initialize` válasz) | `package.json` `version` — a `src/index.ts` `createRequire(import.meta.url)("../package.json")`-ból olvassa, nincs hardcode |
| `manifest.json` **verziója** | generált, a `scripts/sync-manifest.mjs` írja (a `version` npm lifecycle és a `bundle` script hívja); kézi szerkesztés a következő szinkronig felülíródik |
| `manifest.json` **`tools[]` tömbje** | generált: a `sync-manifest.mjs` a lefordított `dist/index.js`-t elindítja stdio-n, és a `tools/list` `name` + a leírás **első mondata** párokból írja. Egyetlen forrás a kód (`src/tools/*.ts`) |
| Egy eszköz **válaszának alakja** | `src/schema.ts` `outputSchema`-ja, ahol a választ a szerver építi (öt eszköz); a passthrough eszközöknél a Flex válasza az egyetlen forrás — ezért ott nincs séma |
| Szerver kódja | `src/` — lásd [`src/CLAUDE.md`](src/CLAUDE.md) |
| Tesztek | `test/*.test.ts`, futtatás: `npm test` (`node --import tsx --test`) |
| CI | `.github/workflows/ci.yml` — `npm ci && npm run build && npm test` |

## Kulcsdöntések és rögzített szabályok

- **A verzió egyetlen forrása a `package.json`.** Korábban `src/index.ts`-ben hardcode-olt string
  volt a `McpServer` konstruktorában, ami könnyen elszakadt a valós kiadástól — a `.mcpb` csomag
  build/pkg/dist-je alól is ugyanoda (`../package.json`) mutat, ezért működik dist-ből és a
  becsomagolt verzióból is.
- **A `manifest.json` `version` mezője generált, nem kézzel írt** — a `sync-manifest.mjs`
  idempotens (kétszer futtatva ugyanazt adja), és az `npm version` / `npm run bundle` elé van
  kötve, hogy a kiadás sose maradjon szinkronon kívül.
- **A `manifest.tools[]` is generált, a *lefordított* szerverből** (WF10). Korábban kézzel
  duplikálta a kód leírásait, szinkron-őr nélkül — így a manifest olyan eszközt is ígérhetett
  volna, amit a csomagolt szerver nem regisztrál. Miért a `dist/index.js`-ből és nem a forrásból:
  pontosan azt a szervert kérdezzük meg, ami a `.mcpb`-be kerül. Ezért a `bundle` **először
  fordít, utána szinkronizál** (a WF10 előtt fordítva volt), és a `dist/` hiányában a szkript a
  `tools` tömböt érintetlenül hagyja, figyelmeztetéssel — üres tool-listát írni rosszabb lenne.
- **`node:test` a tesztkerethez, nem Jest/Vitest** — miért: zéró új futásidejű függőség, a `tsx`
  amúgy is dev-függőség volt. Futtatás közvetlenül a `.ts` forrásból, nem a `dist`-ből.
- **Node 20 minimum** (`engines`, `manifest.json` `compatibility.runtimes.node`, mindkét
  INSTALL-doksi) — a `tsx` 4.22 és a friss `@modelcontextprotocol/sdk` ezt várja el; a korábbi
  `>=18` elavult volt.
- **Minden tool-eredmény redaktálva megy vissza, egyetlen ponton** (`src/redact.ts` a
  `format.ts` `toolJson`/`formatError`-én át). Miért nem csak a `/diag`-nál: a szűrés így nem
  kerülhető meg egy később hozzáadott eszközzel, és a hibatörzsek is átmennek rajta. Részletek:
  [`src/CLAUDE.md`](src/CLAUDE.md).
- **A `flex_diag` a `/diag` válaszából csak a `method`/`uri`/`qs` mezőt adja vissza.** Miért:
  a Flex `/diag` visszatükrözi a kérés fejléceit (Bearer token) és a backend környezeti változóit
  (`APP_KEY`) — ezekre a diagnosztikának nincs szüksége, ezért fel sem vesszük a válaszba; a
  redakció csak a második védvonal. A backend-oldali javítás (P0-2) a Flex csapatnál nyitott.
- **A csatolmány-letöltés csak a letöltési könyvtár alá írhat** (`FLEX_DOWNLOAD_DIR`, vagy az OS
  temp `dmsone-flex` almappája), és **meglévő fájlt sosem ír felül** (`-1`, `-2`… utótag + `wx`
  flag). Miért: a `savePath` a modelltől, a fájlnév a Flex szervertől jön — mindkettő nem
  megbízható, és korábban mindkettő szó szerint került az útvonalba (P0-3). Az útvonal-döntések
  egy helyen, tiszta függvényekben vannak (`src/paths.ts`), hogy platformtól függetlenül
  tesztelhetők legyenek; a symlink-eset ellen a szülőkönyvtár `realpath`-ja is ellenőrzött.
  Részletek: [`src/CLAUDE.md`](src/CLAUDE.md).
- **Az annotációk azt mondják, amit az eszköz tesz** (P0-4): a letöltés `readOnlyHint: false`
  (fájlt ír) és `idempotentHint: false` (ütközésnél új név); a munkafolyamat-indítás, a
  munkafolyamat-feladat lezárása és a Task-lezárás `destructiveHint: true` (innen nem
  visszavonható). A Task-elfogadás marad nem destruktív. Miért számít: a Claude Desktop ezekből
  dönt a megerősítés-kérésről. A `test/tools-list.test.ts` a protokollon át őrzi őket.
- **`@modelcontextprotocol/sdk` `^1.30.0`, `axios` `^1.20.0`** — a `npm audit fix` (nem `--force`)
  a maradék tranzitív sebezhetőségeket (SDK belső `hono`/`ip-address`/`qs` — ezeket csak a
  streamable-HTTP transzporthoz hozza be a csomag, mi stdio-t használunk, de a lockfile-ban benne
  vannak) is megoldotta lockfile-on belüli, nem-breaking frissítéssel. `npm audit` jelenleg tiszta.
- **A Flex dátummezői falióra-idők, nem időpillanatok.** A `formatDateTime` ezért offset nélküli
  bemenetet változatlanul hagy, és csak offsettel megadott értéket számol át a `FLEX_TIMEZONE`
  zónájára (alap `Europe/Budapest`). Miért fontos: a korábbi `toISOString()` mindig UTC-re
  konvertált, így egy nyári `…+02:00` határidő két órával korábbra ment be (P0-5). Részletek és
  él-esetek: [`src/CLAUDE.md`](src/CLAUDE.md).
- **A kötelező-mező ellenőrzés nyíltan best-effort.** Csak akkor fut, ha a sablon mezői egyáltalán
  hordoznak `required`/`mandatory` jelölést; a `flex_workflow_get_template_details` ezt a
  `validation: "api-flag" | "none"` mezőben mondja ki. Miért: a Flex startDetails a 66-os sablonnál
  nem jelöl kötelezőséget (csak `visibility: MT_K`/`MT_M`), a régi kód mégis „ellenőrzött"-nek
  mutatkozott, miközben mindent átengedett (P0-6). Hogy a `MT_K` jelent-e kötelezőséget, az a
  Flex csapatnál nyitott kérdés — addig az érdemi ellenőrzés a szerveré.
- **A `/dms/news` (`flex_task_list`) vegyes listájának minden eleme explicit `idKind`-ot kap**
  (P1-5/P1-6, WF11): `"taskId"` vagy `"wfTaskId"`, a `type` mezőből származtatva. Miért nem elég a
  `type`: a modellnek konkrét eszköznevet kell választania (`flex_task_*` vagy `flex_workflow_*`),
  és egy string-egyezés (`"WfTask"`) helyett egyértelműbb, ha a szerver már kimondja, melyik
  eszközcsalád kezeli az adott `id`-t.
- **A `performerOrgId` / `responsibleOrgId`-nak nincs néma `1` alapértelmezése** (P1-5/P1-6, WF11).
  Korábban egy meg nem adott szervezeti egység csendben `1`-re esett vissza — ez rossz szervezeti
  egységhez rendelt feladatot/folyamatot okozhatott anélkül, hogy bárki észrevette volna. Most
  mindkettő kötelező (a `flex_task_create`-nél a `performerUserId` megadásához kötve, futásidőben
  ellenőrizve; a `flex_workflow_start`-nál a séma szintjén), és a leírásuk a forrást is megmondja:
  a `flex_user_get_by_username` válaszának `orgId` mezője.
- **A listázó eszközök lapoznak és alapból összefoglalót adnak** (P1-1). Mérés: a `/dms/news`
  egyetlen hívása 21 elemre **70 645 karakter** volt, a summary ugyanez **7 312** (11,6%). A
  `limit` (alap 20) / `offset` / `fields` szerződés mindkét listázón azonos, a boríték
  `{ total, offset, returned, hasMore, fields, items }`. Miért a kérés oldalán és nem csonkolással:
  a csonkolás a lista közepén vág el, a modell pedig nem tudja, mi maradt ki — a `hasMore`
  viszont kimondja. Részletek és a mezőnkénti indoklás: [`src/CLAUDE.md`](src/CLAUDE.md).
- **A konfig-validáció (`validateConfig`) elkülönül a betöltéstől (`loadConfig`).** A `loadConfig()`
  sosem lép ki és nem ír stderr-re — csak a hívó (`index.ts`) dönt arról, hogy egy hiba kilépést
  jelent-e. Miért fontos: üres token, publikus URL-en kikapcsolt SSL-ellenőrzés → **hiba**, kilépés;
  fejlesztői URL-en kikapcsolt SSL, vagy PAT módban megadott impersonáció → csak **figyelmeztetés**,
  a szerver elindul. A publikus `flex.dmsone.hu` host és az SSL-kikapcsolás együtt korábban csendben
  átment volna (P0-8); a PAT+impersonáció kombináció pedig érvényes konfignak tűnt, miközben az
  impersonáció ilyenkor hatástalan (P0-9).

## Nyitva maradt

- **Flex-oldali hibák a `/dms/news`-on (WF9-ben találva, 2026-09-03).** Kettő, mindkettő a Flex
  szerverben, MCP-oldalon nincs mit javítani — a hívás helyes, a hibaüzenet a felhasználóhoz eljut.
  Részletek, reprodukció és a kérés: [`../flex-diag-hibajelentes.md`](../flex-diag-hibajelentes.md)
  2. és 3. pontja.
  1. **`status: "all"` → HTTP 500.** Ilyenkor a szerver (a referencia n8n node-dal egyezően)
     szándékosan nem küld `status` paramétert, a Flex viszont elhasal rajta:
     `getWorkflowTaskSql(): Argument #2 ($statusFilter) must be of type string, null given`.
     A tool leírása ezért **kimondja**, hogy ez ma hibára fut — a leírás-őszinteség szabálya
     a szerveroldali hibára is vonatkozik, mert a modellnek ebből kell döntenie.
  2. **A `pending` és a `completed` bájtra azonos választ ad** (50 elem, benne 15 darab `FA_U`
     státuszú, azaz nyitott feladat). Nem tudjuk, mi a szándékolt viselkedés — a jelentés
     rákérdez. A leírás ezt is megemlíti.
- **P0-2**: a `/diag` végpont backend-oldali szűrése — a jelentés szövege kész
  (`../flex-diag-hibajelentes.md`), elküldése a Flex csapatnak a felhasználó lépése.
- **P0-6 Flex-oldali fele**: mi jelöli a kötelezőséget a startDetails válaszában (a `visibility:
  MT_K` az?) — ugyanabban a jelentésben (`../flex-diag-hibajelentes.md`) felvetve. Amíg nincs
  válasz, a `validation: "none"` a 66-os sablonnál a helyes, őszinte állapot.
- **A dátumjavítás írás-tesztje**: flex-dev környezetben, egy tesztfeladattal, a felhasználó
  kifejezett jóváhagyásával — alapból kimarad. A `datetime.test.ts` a konverziót Flex nélkül fedi
  le; ami hiányzik, az annak igazolása, hogy a Flex **tényleg** faliórát tárol.
- **Élő sandbox-próba** (opcionális): `savePath: "../x"` → hiba; `savePath: "proba/a.pdf"` → a
  letöltési könyvtár alatt. A WF3 tesztjei ezt fájlrendszer-szinten már lefedik, Flex nélkül.
- **Élő read-only ellenőrzés a felhasználó tokenjével**: a friss `.mcpb` (`dmsone-flex-0.1.1.mcpb`)
  Claude Desktopba telepítése és egy `flex_diag` / `flex_workflow_get_template_details 66` hívás —
  a felhasználó választása, mikor teszi meg. A régi `dmsone-flex-0.1.0.mcpb` szándékosan megmaradt.

## Kapcsolódó

- [`../CLAUDE.md`](../CLAUDE.md) — a `DMS MCP` mappa áttekintése (K2 SOAP szerver, kiértékelési és
  megvalósítási terv)
- [`../../Általános/flex-doc/`](../../Általános/flex-doc/) — a Flex felhasználói felületének
  dokumentációja
