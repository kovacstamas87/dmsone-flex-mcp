# Flex — DMS One Flex REST API MCP szervere

Lokálisan (stdio) futó, TypeScript MCP szerver, amit a Claude Desktop indít alfolyamatként. A
DMS One Flex REST API-t teszi elérhetővé feladatok, munkafolyamatok és felhasználók kezelésére —
minden hívás a beállított token tulajdonosának a nevében fut. Ugyanazokat a végpontokat fedi, mint
a közösségi `n8n-nodes-dmsone-flex` node.

**Állapot (2026-09-03):** **v0.1.1** kiadva (P0: WF1–WF7), a `../flex-mcp-p1-p2-megvalositasi-terv.md`
**P1 üteme fut**: a **WF9** (payload-kontroll), a **WF10** (`outputSchema`, tömör leírások,
generált `manifest.tools`), a **WF11** (Task/WfTask `idKind`, `orgId` alapértelmezés kivezetése), a
**WF12** (minőség-infrastruktúra) és a **WF13** (egyfájlos bundle, manifest 0.3, letöltési
méretkorlát) kész — a két listázó lapoz és összefoglalót ad, a `toolJson` a `structuredContent`-et is
csonkolja, öt eszköz `outputSchema`-t ad, az összleírás 11 936-ról 4 500 alá fogyott, a
`flex_task_list` minden eleme explicit `idKind`-ot (`taskId`/`wfTaskId`) is ad, a
`performerOrgId`/`responsibleOrgId`-nak nincs többé néma `1` alapértelmezése, a szerver eslint +
prettier + typecheck alatt fut CI-mátrixszal (Node 20/22, `npm audit`) és handler-tesztekkel egy fake
`FlexHttp` kliensen, a `.mcpb` pedig 3,79 MB-ról **212 kB**-ra fogyott, `node_modules` nélkül. Build
és teszt zöld (153 teszt). A következő a **WF14** (eval kérdéssor és két mérés).
Nyitva maradt a Flex-oldali P0-2 elküldése, a P0-6 Flex-válasz és az opcionális élő/írás-tesztek —
lásd lent.

## Mappa tartalma

| Fájl / mappa | Mi ez | Állapot |
|---|---|---|
| [`src/`](src/) | A szerver forráskódja — lásd [`src/CLAUDE.md`](src/CLAUDE.md) | WF10 után (`paths.ts` új WF3-ban, `validateConfig` új WF5-ben, `projection.ts` új WF9-ben, `schema.ts` új WF10-ben) |
| [`test/`](test/) | `node:test` alapú tesztek, `tsx`-szel futtatva (`npm test`) — lásd [`test/CLAUDE.md`](test/CLAUDE.md) | WF1–WF5, WF9–WF13-ban bővítve (153 teszt); a `test/fixtures/` élő, **anonimizált** minta |
| [`scripts/bundle.mjs`](scripts/bundle.mjs) | A `.mcpb` előállítása **esbuild egyfájlos bundle-ből**: `dist/index.js` → `build/pkg/dist/index.js`, minimális `package.json`, majd `@anthropic-ai/mcpb pack`. Ellenőrzi, hogy a csomagban nincs `node_modules`, és kiírja a méretet | **új WF13-ban** |
| [`scripts/sync-manifest.mjs`](scripts/sync-manifest.mjs) | A `manifest.json`-t a kódhoz igazítja, idempotens: a `version` a `package.json`-ból, a `tools[]` a **lefordított** `dist/index.js` `tools/list` válaszából. `dist/` hiányában a `tools`-t érintetlenül hagyja és figyelmeztet | **új WF1-ben**; WF10: `tools[]`-generálás |
| `manifest.json` | `.mcpb` csomag metaadata — a `version` **és WF10-től a `tools[]` is generált**, ne szerkeszd kézzel (a `sync-manifest.mjs` írja) | WF1-ben szinkron-forrás lett; WF3: `flex_download_dir` leírása a sandboxot mondja; WF4: új `flex_timezone` konfig-mező; WF10: generált `tools[]`; **WF13: `manifest_version` 0.3**, `repository`/`homepage`/`documentation`/`support`/`author.url`, új `flex_max_download_mb` mező |
| `package.json` / `package-lock.json` | Függőségek, scriptek (`build`, `test`, `bundle`, `sync-manifest`, `version` lifecycle; **WF12-től** `lint`, `lint:fix`, `format:check`, `typecheck`) | WF1-ben frissítve; WF10: új `sync-manifest` script; WF12: minőség-scriptek |
| `eslint.config.js`, `.prettierrc`, `.prettierignore` | Flat eslint-config (`typescript-eslint` recommended) és Prettier-beállítás (`printWidth: 110`) — a doksi (`*.md`, `manifest.json`) szándékosan kimarad a Prettier hatóköréből | **új WF12-ben** |
| `.github/dependabot.yml` | Heti `npm` és `github-actions` függőségfrissítés-figyelés | **új WF12-ben** |
| `INSTALL-WINDOWS.md`, `INSTALL-MACOS.md` | Végfelhasználói telepítési útmutatók | WF1-ben Node 20+ -ra igazítva; WF3: letöltési könyvtár leírása; WF4: „Időzóna" mező a konfig-űrlapon; WF5: SSL-tiltás a publikus URL-en; WF13: letöltés a **Releases** oldalról (nincs hardcode-olt verzió), új „Letöltési méretkorlát” mező a konfig-űrlapon |
| `README.md` | Fejlesztői doksi | WF3: `FLEX_DOWNLOAD_DIR`, WF4: `FLEX_TIMEZONE`, WF5: SSL-tiltás; WF13: `FLEX_MAX_DOWNLOAD_MB`, és a „Kiadás készítése” fejezet az `npm version`-re javítva |
| `CHANGELOG.md` | Kiadási napló | **WF6-ban megírva** a `[0.1.1]` bejegyzés (Security/Fixed/Changed, P0-hivatkozásokkal) |
| `.env.example` | Env változók mintája (`FLEX_TOKEN`, `FLEX_BASE_URL`, …) | WF3: `FLEX_DOWNLOAD_DIR` megjegyzés (abszolút út, sandbox); WF4: `FLEX_TIMEZONE`; WF13: `FLEX_MAX_DOWNLOAD_MB` |
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
| A `.mcpb` **tartalma** | `scripts/bundle.mjs` `COPIED` listája + az esbuild bundle; a `build/pkg/` staging mappa minden futásnál nulláról készül |
| CI | `.github/workflows/ci.yml` — Node 20/22 mátrix: `npm ci`, `lint`, `format:check`, `build`, `test`, `npm audit --audit-level=moderate` |
| Egy tool tesztelhető válasza fake klienssel | `test/handlers.test.ts` — a `FlexHttp` interfész (`src/client.ts`) mögé tett fake, lásd „Kulcsdöntések" |

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
- **A `flex_diag` a `/diag` válaszából csak a `method`/`uri`/`qs` mezőt adja vissza.** Miért: a
  `/diag` visszatükrözi a kérés fejléceit (Bearer token) és a backend env-változóit (`APP_KEY`) —
  ezekre nincs szükség, ezért fel sem vesszük; a redakció csak a második védvonal. A backend-oldali
  javítás (P0-2) a Flex csapatnál nyitott.
- **A csatolmány-letöltés csak a letöltési könyvtár alá írhat** (`FLEX_DOWNLOAD_DIR`, vagy az OS
  temp `dmsone-flex` almappája), és **meglévő fájlt sosem ír felül** (`-1`, `-2`… utótag + `wx`
  flag). Miért: a `savePath` a modelltől, a fájlnév a Flex szervertől jön — mindkettő nem
  megbízható, és korábban mindkettő szó szerint került az útvonalba (P0-3). Az útvonal-döntések
  egy helyen, tiszta függvényekben vannak (`src/paths.ts`); a symlink-eset ellen a szülőkönyvtár
  `realpath`-ja is ellenőrzött. Részletek: [`src/CLAUDE.md`](src/CLAUDE.md).
- **Az annotációk azt mondják, amit az eszköz tesz** (P0-4): a letöltés `readOnlyHint: false`
  (fájlt ír) és `idempotentHint: false` (ütközésnél új név); a munkafolyamat-indítás, a
  munkafolyamat-feladat lezárása és a Task-lezárás `destructiveHint: true` (innen nem
  visszavonható). A Task-elfogadás marad nem destruktív. Miért számít: a Claude Desktop ezekből
  dönt a megerősítés-kérésről. A `test/tools-list.test.ts` a protokollon át őrzi őket.
- **`@modelcontextprotocol/sdk` `^1.30.0`, `axios` `^1.20.0`**, `npm audit` tiszta. Az SDK belső
  `hono`/`ip-address`/`qs` függősége csak a streamable-HTTP transzporthoz kell (mi stdio-t
  használunk), de a lockfile-ban benne van — ezért a Dependabot és a CI-audit figyeli.
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
- **`register*Tools` a `FlexHttp` interfészt kapja, nem a konkrét `FlexClient`-et** (WF12,
  `src/client.ts`). Miért kell a szint: a handler-tesztek (`test/handlers.test.ts`) így egy
  egyszerű, memóriában dolgozó fake-et adhatnak át — rögzített válasz vagy dobott hiba —, HTTP-mock
  könyvtár (pl. `nock`) és hálózat nélkül, a valódi felületet (`request`/`download`) típusból
  kikényszerítve.
- **Eslint (flat config, `typescript-eslint` recommended) + Prettier + `tsc --noEmit`, külön
  scriptekkel** (WF12: `lint`, `lint:fix`, `format:check`, `typecheck`). Az `eslint-config-prettier`
  kikapcsolja az ütköző stílus-szabályokat, hogy a két eszköz ne versengjen ugyanazon a soron. A
  Prettier hatóköre (`.prettierignore`) szándékosan **csak a kód** (`.ts`/`.js`/`.mjs`) — a kézzel
  gondozott doksi (`*.md`) és a generált `manifest.json` kimarad, mert azok újraformázása a WF-en
  kívüli, felesleges diffet adna.
- **A `.mcpb` egyfájlos esbuild-bundle-ből készül, `node_modules` nélkül** (P1-10, WF13). A
  korábbi `npm install --omit=dev` a staging mappában 3,79 MB-os csomagot adott, amiben minden
  tranzitív függőség teljes tartalma (doksi, teszt, source map) a felhasználó gépére került; az
  esbuild csak a tényleg elért kódot fordítja egyetlen `dist/index.js`-be → **212 kB**, 0 futásidejű
  függőség (`npm audit` a csomagra 0, mert nincs mit auditálni). A bundle továbbra is tiszta
  JavaScript, natív bináris nélkül, tehát platformfüggetlen. Két buktató, amit a szkript kezel:
  (1) a `banner` odaadja a CJS-ként írt függőségek által várt `require`/`__filename`/`__dirname`-t,
  amik ESM-ben nem léteznek; (2) a staging mappába **minimális `package.json`** kerül `"type":
  "module"`-lal és `dependencies` nélkül — enélkül a Node CommonJS-ként próbálná betölteni az ESM
  bundle-t, és az `index.ts` `createRequire`-es verzióolvasása sem találna forrást. A szkript
  ellenőrzi is, hogy a kész `.mcpb`-ben nincs `node_modules` bejegyzés, és hibával elesik, ha van.
- **A csatolmány-letöltésnek felső mérethatára van** (`FLEX_MAX_DOWNLOAD_MB`, alap 50 MB; B11,
  WF13). Miért kell: a `client.download()` a választ teljes egészében memóriába olvassa (a Flex nem
  ad részleges letöltést), és a szerver a Claude Desktop alfolyamata — korlát nélkül egy nagy
  melléklet a beszélgetés közepén viszi el a folyamatot. A korlát az axios `maxContentLength`-je,
  ezért a `Content-Length` fejlécet előre és a folyamot közben is ellenőrzi: hiányzó vagy hazudó
  fejléc nem kerüli meg. A túllépés **hiba, nem csonkolás** — egy félig letöltött fájl rosszabb
  lenne, mint a hibaüzenet —, és magyar, cselekvésre fordítható szöveget ad
  (`DownloadTooLargeError`), nem az axios angol bájtszámát. Egy elírt vagy nulla/negatív
  `FLEX_MAX_DOWNLOAD_MB` az alapértelmezésre esik vissza, hangosan: a csendes 0 azt jelentené, hogy
  *minden* letöltés hibára fut.
- **A verziót az `npm version` emeli, egy helyen** (WF13, README „Kiadás készítése"). Korábban a
  README kézi, kétszeres verzióemelést írt (`package.json` **és** `manifest.json`) — ez pontosan az
  az elsodródás, amit a `version` npm-hook (`sync-manifest.mjs` + `git add manifest.json`) kizár.
- **A CI Node 20/22 mátrixon fut, és `npm audit`-ot is végez** (WF12). Miért két verzió: az
  `engines` `>=20`-at ír elő, a mátrix ezt a határt és a következő LTS-t is lefedi egyetlen
  workflow-fájlból. Az `npm audit --audit-level=moderate` a függőség-frissítések (Dependabot) mellé
  ad folyamatos ellenőrzést, nem csak kiadáskor.

## Nyitva maradt

- **Flex-oldali hibák a `/dms/news`-on (WF9-ben találva, 2026-09-03).** Kettő, mindkettő a Flex
  szerverben, MCP-oldalon nincs mit javítani — a hívás helyes, a hibaüzenet a felhasználóhoz eljut.
  Részletek, reprodukció és a kérés: [`../flex-diag-hibajelentes.md`](../flex-diag-hibajelentes.md)
  2. és 3. pontja.
  1. **`status: "all"` → HTTP 500** (a szerver a referencia n8n node-dal egyezően nem küld `status`
     paramétert, a Flex ezen elhasal). 2. **A `pending` és a `completed` bájtra azonos választ ad**,
     benne nyitott (`FA_U`) feladatokkal. Mindkettőt **kimondja a `flex_task_list` leírása** — a
     leírás-őszinteség szabálya a szerveroldali hibára is vonatkozik, mert a modellnek ebből kell
     döntenie.
- **P0-2**: a `/diag` végpont backend-oldali szűrése — a jelentés szövege kész
  (`../flex-diag-hibajelentes.md`), elküldése a Flex csapatnak a felhasználó lépése.
- **P0-6 Flex-oldali fele**: mi jelöli a kötelezőséget a startDetails válaszában (a `visibility:
  MT_K` az?) — ugyanabban a jelentésben (`../flex-diag-hibajelentes.md`) felvetve. Amíg nincs
  válasz, a `validation: "none"` a 66-os sablonnál a helyes, őszinte állapot.
- **A dátumjavítás írás-tesztje** (flex-dev, tesztfeladat, kifejezett jóváhagyással) és az **élő
  sandbox-próba** — alapból kimaradnak. A `datetime.test.ts` és a WF3 tesztjei a konverziót és az
  útvonal-korlátot Flex nélkül lefedik; ami hiányzik, az annak igazolása, hogy a Flex **tényleg**
  faliórát tárol.
- **Élő read-only ellenőrzés a felhasználó tokenjével**: a friss `.mcpb` Claude Desktopba
  telepítése és egy `flex_diag` hívás — a felhasználó választása, mikor teszi meg. (A csomagolt
  szerver `initialize` + `tools/list` + `tools/call` válaszát a WF13 Flex nélkül ellenőrizte.)

## Kapcsolódó

- [`../CLAUDE.md`](../CLAUDE.md) — a `DMS MCP` mappa áttekintése (K2 SOAP szerver, kiértékelési és
  megvalósítási terv)
- [`../../Általános/flex-doc/`](../../Általános/flex-doc/) — a Flex felhasználói felületének
  dokumentációja
