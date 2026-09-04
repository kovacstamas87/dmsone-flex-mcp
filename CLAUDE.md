# Flex — DMS One Flex REST API MCP szervere

Lokálisan (stdio) futó, TypeScript MCP szerver, amit a Claude Desktop indít alfolyamatként. A
DMS One Flex REST API-t teszi elérhetővé feladatok, munkafolyamatok és felhasználók kezelésére —
minden hívás a beállított token tulajdonosának a nevében fut. Ugyanazokat a végpontokat fedi, mint
a közösségi `n8n-nodes-dmsone-flex` node.

**Állapot (2026-09-04):** **v1.0.4** kiadva — az Option-címkékből kimarad a `params` kódprefixe
(`"1|hétfő"` → `"hétfő"`); a hiba az 59-es sablonon derült ki az 1.0.3 élő ellenőrzésekor, és
egyben megerősítette a `params` alakját: `<kiválasztott kód>|<címkék>`. Előtte **v1.0.3** kiadva és
**élesben ellenőrizve** (`CHANGELOG.md` `[1.0.3]`) — a hiányzó `deadline`
előre jelzése a sablon javaslatával (a Flex 500-cal utasítja el a határidő nélküli indítást,
élőben mérve), `suggestedDeadline` a sablon-részletekben, és a `typescript` / `@types/node`
major frissítés kikapcsolása a Dependabotban. A határidő-hiba előre jelzése és a javaslattal induló folyamat (188) a csatlakoztatott
bővítményen igazolt, és a `flex_task_create` is lefutott élesben (`taskId 100`) —
részletek a `../flex-mcp-eval/meresek.md` 6. szakaszában. Az **1.0.2 élesben ellenőrizve**: a folyamat 196
(`wfTaskId` 5166) létrejött, a címkével megadott Option `value: "4"`-ként, az
`…T01:30+05:00` határidő `2026-09-24`-ként tárolódott — vagyis a kód-származtatás és a
zóna-átszámítás utáni dátumvágás is igazolt.

**Előző (2026-09-04):** **v1.0.2** kiadva (`CHANGELOG.md` `[1.0.2]`) — az indítás és a
feladat-létrehozás kérés-törzsének javítása: teljes kulcskészlet üres értékkel is, Option
kód/címke-feloldás, `deadline` `YYYY-MM-DD`, `attachmentTypeCode`, `performerOrgCodes`,
`FLEX_DEBUG` nyomkövetés. 234 teszt zöld.

**Állapot (2026-09-03):** **v1.0.1** kiadva (P0-6 javítása, `CHANGELOG.md` `[1.0.1]`) — korábban
**v1.0.0** (WF21) — a `../flex-mcp-p1-p2-megvalositasi-terv.md`
**P0, P1 és P2 üteme MCP-oldalon kész**: P0/P1 a `[0.2.0]`-ban (WF1–WF15 — benne a kötelező
`performerOrgId`/`responsibleOrgId`, **áttörő változás a hívó modellnek**), P2 a `[1.0.0]`-ban
(`CHANGELOG.md`) — **WF20** SDK v2 (`@modelcontextprotocol/sdk@1.30` → `server@2.0.0`, `zod@3` →
`zod@4`; a `tools/list` a kliens felé változatlan), **WF17** prompt-injection jelölés (P2-4/B9),
**WF18** Resources + Prompts (P2-2/P2-3): három resource, három vezetett prompt,
`templateId`-completion, **WF19** induláskori token-ellenőrzés (`FLEX_CHECK_ON_START`, opt-in). 217
teszt zöld. A `../flex-mcp-kiertekelesi-terv.md` 8. fejezete (lezárási feltételek) és a 3.5
pontozás a WF21-ben lezárva/újramérve. **P0-6 lezárva** (2026-09-03, kiadás után, élő
UI-egyeztetéssel — lásd lent „Kulcsdöntések"). Nyitva: a Flex-oldali P0-2 (a `/diag` a WF21
ellenőrzésekor is még tükrözi a Bearer tokent — jelentve), és a teljes Claude Desktop UX-mérés
(hívásszám/token) — lásd lent és `../flex-mcp-eval/meresek.md` 4. szakasza.

## Mappa tartalma

| Fájl / mappa | Mi ez | Állapot |
|---|---|---|
| [`src/`](src/) | A szerver forráskódja — lásd [`src/CLAUDE.md`](src/CLAUDE.md) | **`debug.ts` új 2026-09-04-én**; WF10 után (`paths.ts` új WF3-ban, `validateConfig` új WF5-ben, `projection.ts` új WF9-ben, `schema.ts` új WF10-ben, `untrusted.ts` új WF17-ben, **`resources.ts` + `prompts.ts` új WF18-ban**) |
| [`test/`](test/) | `node:test` alapú tesztek, `tsx`-szel futtatva (`npm test`) — lásd [`test/CLAUDE.md`](test/CLAUDE.md) | WF1–WF5, WF9–WF14, WF17–WF19-ben bővítve (214 teszt); a `test/fixtures/` élő, **anonimizált** minta |
| [`scripts/bundle.mjs`](scripts/bundle.mjs) | A `.mcpb` előállítása **esbuild egyfájlos bundle-ből**: `dist/index.js` → `build/pkg/dist/index.js`, minimális `package.json`, majd `@anthropic-ai/mcpb pack`. Ellenőrzi, hogy a csomagban nincs `node_modules`, és kiírja a méretet | **új WF13-ban** |
| [`scripts/audit.sh`](scripts/audit.sh) | A CI záró `npm audit` lépése, ami a **registry kiesését nem minősíti kódhibának**: az infrastruktúra-hibát (503 / hálózat) `::warning::`-gal átengedi (`AUDIT_ATTEMPTS` kísérlet után), a valódi sebezhetőséget viszont `::error::`-ral elbuktatja. Miért kell: az `npm audit` mindkettőre exit 1-et ad, és az advisory API-nak nincs offline módja — 2026-09-04-én egy npm-oldali üzemzavar fél órán belül kétszer buktatta el a teljes CI-t változatlan kódon. Osztályozás a kimenet szövegére; a mintalista a scriptben | **új 2026-09-04-én** |
| [`scripts/sync-manifest.mjs`](scripts/sync-manifest.mjs) | A `manifest.json`-t a kódhoz igazítja, idempotens: a `version` a `package.json`-ból, a `tools[]` a **lefordított** `dist/index.js` `tools/list` válaszából. `dist/` hiányában a `tools`-t érintetlenül hagyja és figyelmeztet | **új WF1-ben**; WF10: `tools[]`-generálás |
| `manifest.json` | `.mcpb` csomag metaadata — a `version` **és WF10-től a `tools[]` is generált**, ne szerkeszd kézzel (a `sync-manifest.mjs` írja); a `user_config` és a `mcp_config.env` továbbra is kézzel gondozott | WF1-ben szinkron-forrás lett; WF3: `flex_download_dir` leírása a sandboxot mondja; WF4: új `flex_timezone` konfig-mező; WF10: generált `tools[]`; **WF13: `manifest_version` 0.3**, `repository`/`homepage`/`documentation`/`support`/`author.url`, új `flex_max_download_mb` mező; **WF19: új `flex_check_on_start` mező** |
| `package.json` / `package-lock.json` | Függőségek, scriptek (`build`, `test`, `bundle`, `sync-manifest`, `version` lifecycle; **WF12-től** `lint`, `lint:fix`, `format:check`, `typecheck`) | WF1-ben frissítve; WF10: új `sync-manifest` script; WF12: minőség-scriptek; **WF20: SDK v2** — futásidőben `@modelcontextprotocol/server ^2.0.0` + `zod ^4.2.0`, dev-függőségként `@modelcontextprotocol/client ^2.0.0` (csak a tesztek és a `sync-manifest.mjs` használják) |
| `eslint.config.js`, `.prettierrc`, `.prettierignore` | Flat eslint-config (`typescript-eslint` recommended) és Prettier-beállítás (`printWidth: 110`) — a doksi (`*.md`, `manifest.json`) szándékosan kimarad a Prettier hatóköréből | **új WF12-ben** |
| `.github/dependabot.yml` | Heti `npm` és `github-actions` függőségfrissítés-figyelés | **új WF12-ben** |
| `INSTALL-WINDOWS.md`, `INSTALL-MACOS.md` | Végfelhasználói telepítési útmutatók | WF1-ben Node 20+ -ra igazítva; WF3: letöltési könyvtár leírása; WF4: „Időzóna" mező a konfig-űrlapon; WF5: SSL-tiltás a publikus URL-en; WF13: letöltés a **Releases** oldalról (nincs hardcode-olt verzió), új „Letöltési méretkorlát” mező a konfig-űrlapon; WF19: új „Kapcsolat ellenőrzése induláskor” mező |
| `README.md` | Fejlesztői doksi | WF3: `FLEX_DOWNLOAD_DIR`, WF4: `FLEX_TIMEZONE`, WF5: SSL-tiltás; WF13: `FLEX_MAX_DOWNLOAD_MB`, és a „Kiadás készítése” fejezet az `npm version`-re javítva; WF19: `FLEX_CHECK_ON_START` |
| `CHANGELOG.md` | Kiadási napló | **WF6**: `[0.1.1]`; **WF15**: `[0.2.0]`; **WF21**: `[1.0.0]` (P2-hivatkozásokkal, eval-újrafuttatással) |
| `.env.example` | Env változók mintája (`FLEX_TOKEN`, `FLEX_BASE_URL`, …) | WF3: `FLEX_DOWNLOAD_DIR` megjegyzés (abszolút út, sandbox); WF4: `FLEX_TIMEZONE`; WF13: `FLEX_MAX_DOWNLOAD_MB`; WF19: `FLEX_CHECK_ON_START` |
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
| CI | `.github/workflows/ci.yml` — Node 20/22 mátrix: `npm ci`, `lint`, `format:check`, `build`, `test`, `npm audit --audit-level=moderate`. A **20-as leg marad**, amíg az `engines` és a `manifest.json` `compatibility` `>=20`-at ígér — az ígéretet tesztelni kell. Az action-ök `@v5`-en vannak (2026-09-04), mert a `@v4` futtatókörnyezete Node 20-as, amit a GitHub elavultnak jelöl. A záró audit a [`scripts/audit.sh`](scripts/audit.sh)-en megy: registry-kiesésre (503) figyelmeztet és **átengedi**, valódi sebezhetőségre **bukik** — 2026-09-04-én fél órán belül kétszer állt a végpont. A mátrix `fail-fast: false` |
| Resource-ok és promptok | `src/resources.ts`, `src/prompts.ts`; a felületet a `test/resources-prompts.test.ts` rögzíti (protokollon át) |
| Egy tool tesztelhető válasza fake klienssel | `test/handlers.test.ts` — a `FlexHttp` interfész (`src/client.ts`) mögé tett fake, lásd „Kulcsdöntések" |

## Kulcsdöntések és rögzített szabályok

- **A verzió egyetlen forrása a `package.json`.** Korábban `src/index.ts`-ben hardcode-olt string
  volt, ami könnyen elszakadt a valós kiadástól — a `createRequire`-es olvasás a `.mcpb` csomag
  alól is ugyanoda (`../package.json`) mutat, ezért működik dist-ből és becsomagolva is.
- **A `manifest.json` `version` mezője generált, nem kézzel írt** — a `sync-manifest.mjs`
  idempotens (kétszer futtatva ugyanazt adja), és az `npm version` / `npm run bundle` elé van
  kötve, hogy a kiadás sose maradjon szinkronon kívül.
- **A `manifest.tools[]` is generált, a *lefordított* szerverből** (WF10). Korábban kézzel
  duplikálta a kód leírásait, szinkron-őr nélkül — így olyan eszközt is ígérhetett, amit a
  csomagolt szerver nem regisztrál. Miért a `dist/`-ből: pontosan azt a szervert kérdezzük meg, ami
  a `.mcpb`-be kerül; ezért a `bundle` **először fordít, utána szinkronizál**, és `dist/` hiányában
  a `tools` tömb érintetlen marad, figyelmeztetéssel — üres tool-listát írni rosszabb lenne.
- **`node:test` a tesztkerethez, nem Jest/Vitest** — zéró új futásidejű függőség, a `tsx` amúgy is
  dev-függőség volt; futtatás közvetlenül a `.ts` forrásból, nem a `dist`-ből. **Node 20 minimum**
  (`engines`, `manifest.json` `compatibility.runtimes.node`, mindkét INSTALL-doksi) — a `tsx` 4.22
  és a `@modelcontextprotocol/server` v2 (`engines >=20`) ezt várja el; a korábbi `>=18` elavult volt.
- **Minden tool-eredmény redaktálva megy vissza, egyetlen ponton** (`src/redact.ts` a
  `format.ts` `toolJson`/`formatError`-én át) — így a szűrés nem kerülhető meg egy később hozzáadott
  eszközzel. Részletek: [`src/CLAUDE.md`](src/CLAUDE.md). **A `flex_diag` a `/diag` válaszából csak a
  `method`/`uri`/`qs` mezőt adja vissza** — a `/diag` visszatükrözi a kérés fejléceit (Bearer token)
  és a backend env-változóit (`APP_KEY`), ezekre nincs szükség; a redakció csak a második védvonal.
  A backend-oldali javítás (P0-2) a Flex csapatnál nyitott, és a WF21 ellenőrzésekor (más, a
  Claude Code munkamenetbe kötött instance-en) még mindig megfigyelhető.
- **A csatolmány-letöltés csak a letöltési könyvtár alá írhat** (`FLEX_DOWNLOAD_DIR`, vagy az OS
  temp `dmsone-flex` almappája), és **meglévő fájlt sosem ír felül**. Miért: a `savePath` a
  modelltől, a fájlnév a Flex szervertől jön — mindkettő nem megbízható, és korábban mindkettő szó
  szerint került az útvonalba (P0-3). Az útvonal-döntések tiszta függvényekben, egy helyen
  (`src/paths.ts`); részletek és él-esetek: [`src/CLAUDE.md`](src/CLAUDE.md).
- **Az annotációk azt mondják, amit az eszköz tesz** (P0-4): a letöltés `readOnlyHint: false` és
  `idempotentHint: false`; a folyamat-indítás, a wfTask- és a Task-lezárás `destructiveHint: true`
  (innen nem visszavonható); a Task-elfogadás nem destruktív. Miért számít: a Claude Desktop
  ezekből dönt a megerősítés-kérésről. A `test/tools-list.test.ts` a protokollon át őrzi őket.
- **SDK v2: `@modelcontextprotocol/server` `^2.0.0` + `zod` `^4.2.0` futásidőben,
  `@modelcontextprotocol/client` `^2.0.0` dev-ként, `axios` `^1.20.0`**, `npm audit` tiszta (WF20,
  P2-1). **Miért most:** a WF16 kapu-mérése önmagában no-go volt (a Desktop 2026-07-28-as
  spec-egyeztetése a szerkesztett logból nem igazolható), a felhasználó ezt **tudatosan
  felülbírálta** — [`../flex-mcp-p1-p2-megvalositasi-terv.md`](../flex-mcp-p1-p2-megvalositasi-terv.md)
  „WF20 kapu-döntés". **Visszavonható:** a `v0.2.0` tag az 1.30-as, működő állapot. A migráció
  előtti/utáni `tools/list` + `initialize` snapshot-diff igazolja, hogy a kliens ugyanazt látja: név,
  cím, leírás, annotáció, `instructions` **bájtra azonos**, a sémák csak a v2 JSON Schema-dialektus
  ekvivalens írásmódjaiban térnek el (tételesen: `CHANGELOG.md` `[1.0.0]`).
- **A Flex dátummezői falióra-idők, nem időpillanatok.** A `formatDateTime` offset nélküli
  bemenetet változatlanul hagy, és csak offsettel megadott értéket számol át a `FLEX_TIMEZONE`
  zónájára. Miért fontos: a korábbi `toISOString()` mindig UTC-re konvertált, így egy nyári
  `…+02:00` határidő két órával korábbra ment be (P0-5). Részletek: [`src/CLAUDE.md`](src/CLAUDE.md).
- **A kötelező-mező ellenőrzés nyíltan best-effort, két forrással.** Elsősorban a
  `required`/`mandatory` jelölést nézi; ha az hiányzik, a `visibility: "MT_K"`-ra esik vissza — a
  `flex_workflow_get_template_details` ezt a `validation: "api-flag" | "visibility-flag" | "none"`
  mezőben mondja ki. **P0-6 lezárva (2026-09-03):** élő UI-egyeztetés (a "Belső projekt jóváhagyás
  (v6)" sablon "Létrehozás" dialógusa, 6/6 mezőn) igazolta, hogy a Flex a `MT_K` mezőket jelöli
  kötelezőnek a `visibility: MT_M`-mel szemben — korábban a régi kód ezt `required: false`-ra
  fordítva „ellenőrzött"-nek mutatkozott, miközben mindent átengedett. Ez nincs írott Flex-doksiban,
  ezért a `"visibility-flag"` gyengébb forrásnak számít, mint egy explicit kulcs (`"api-flag"`).
- **A `/dms/news` (`flex_task_list`) vegyes listájának minden eleme explicit `idKind`-ot kap**
  (P1-5/P1-6, WF11): `"taskId"` vagy `"wfTaskId"`, a `type` mezőből származtatva. Miért nem elég a
  `type`: a modellnek konkrét eszköznevet kell választania (`flex_task_*` vagy `flex_workflow_*`),
  és egy string-egyezés (`"WfTask"`) helyett egyértelműbb, ha a szerver már kimondja, melyik
  eszközcsalád kezeli az adott `id`-t.
- **A `performerOrgId` / `responsibleOrgId` kötelező, és a leírás megmondja, honnan jön — és honnan
  NEM** (P1-5/P1-6 WF11, javítva WF14). Korábban a meg nem adott szervezeti egység csendben `1`-re
  esett vissza, ami észrevétlenül rossz szervezeti egységhez rendelhetett feladatot; most mindkettő
  kötelező. A WF11 leírása viszont a `flex_user_get_by_username` *válaszának* `orgId` mezőjére
  mutatott, a `/dms/ac/user` pedig csak `userId`-t és `userName`-et ad (élő mintavétel, WF14) — a
  leírás-őszinteség tehát nem csak a *túl sokat ígérésre* vonatkozik, hanem a **rossz helyre
  mutatásra** is. A valódi forrás (a `flex_task_list` elemeinek `orgId`-ja vagy egy wfTask
  `wfDetails.responsibleUser.orgId`-ja) **egy helyen** van kimondva, a felhasználó-kereső
  leírásában; a két paraméter csak odamutat, mert a WF10 leírás-költségvetése valós teher. Ugyanitt
  derült ki, hogy a keresés **ékezet-érzékeny** (`"ková"` talál, `"kovacs"` nem).
- **A listázó eszközök lapoznak és alapból összefoglalót adnak** (P1-1). Mérés: a `/dms/news`
  egyetlen hívása 21 elemre **70 645 karakter** volt, a summary ugyanez **7 312** (11,6%). A
  `limit` (alap 20) / `offset` / `fields` szerződés mindkét listázón azonos, a boríték
  `{ total, offset, returned, hasMore, fields, items }`. Miért a kérés oldalán és nem csonkolással:
  a csonkolás a lista közepén vág el, a modell pedig nem tudja, mi maradt ki — a `hasMore`
  viszont kimondja. Részletek és a mezőnkénti indoklás: [`src/CLAUDE.md`](src/CLAUDE.md).
- **A felhasználó által írt szöveg jelölve megy a modellnek, HTML nélkül** (P2-4/B9, WF17). Leírás,
  tárgy, megjegyzés, szöveges metaadat más felhasználók gépelt szövege, ami utasításnak látszhat
  (prompt-injection). A `src/untrusted.ts` a `text`-ben `<untrusted source="flex:…">` keretbe teszi
  (belülről nem hamisítható), a `structuredContent`-be puszta szöveget + `untrustedFields`-et ad, az
  `instructions` kimondja: adat, nem utasítás. Jelölés + instrukció, nem kényszer — az automatizált
  injection-fixture (`test/untrusted.test.ts`, WF21-ben igazolva) méri. Miért két csatorna, miért
  zéró függőség: [`src/CLAUDE.md`](src/CLAUDE.md).
- **Ami állapot, az resource; ami vezetett munkamenet, az prompt** (P2-2/P2-3, WF18). A három
  resource (`flex://templates`, `flex://template/{id}`, `flex://my-tasks`) ugyanazt adja, mint a
  megfelelő csak-olvasó eszköz — a különbség az, **ki kezdeményez**: a resource-t a felhasználó
  csatolja a kliens „+" menüjéből, a toolt a modell hívja; mellékhatásos műveletnek ezért nincs
  resource-változata. A három prompt a **lépések sorrendjét** rögzíti, és minden visszavonhatatlan
  lépés előtt jóváhagyást kér — szöveggel, nem kóddal. Részletek és a completion döntései:
  [`src/CLAUDE.md`](src/CLAUDE.md).
- **A konfig-validáció (`validateConfig`) elkülönül a betöltéstől (`loadConfig`).** A `loadConfig()`
  sosem lép ki és nem ír stderr-re — a hívó (`index.ts`) dönt. Üres token és publikus URL-en
  kikapcsolt SSL → **hiba**, kilépés; fejlesztői URL-en kikapcsolt SSL vagy PAT módban megadott
  impersonáció → csak **figyelmeztetés**. Az első kombináció korábban csendben átment (P0-8), a
  második érvényes konfignak tűnt, miközben az impersonáció hatástalan (P0-9).
- **`register*Tools` a `FlexHttp` interfészt kapja, nem a konkrét `FlexClient`-et** (WF12,
  `src/client.ts`). Miért kell a szint: a handler-tesztek (`test/handlers.test.ts`) így egy
  egyszerű, memóriában dolgozó fake-et adhatnak át — rögzített válasz vagy dobott hiba —, HTTP-mock
  könyvtár (pl. `nock`) és hálózat nélkül, a valódi felületet (`request`/`download`) típusból
  kikényszerítve.
- **Eslint (flat config) + Prettier + `tsc --noEmit`, külön scriptekkel** (WF12). A Prettier hatóköre
  szándékosan **csak a kód**: a kézzel gondozott doksi és a generált `manifest.json` kimarad, mert
  azok újraformázása felesleges diffet adna.
- **A `.mcpb` egyfájlos esbuild-bundle-ből készül, `node_modules` nélkül** (P1-10, WF13). A
  korábbi `npm install --omit=dev` 3,79 MB-os csomagot adott, amiben minden tranzitív függőség
  teljes tartalma (doksi, teszt, source map) a felhasználó gépére került; az esbuild csak a tényleg
  elért kódot fordítja, 0 futásidejű függőséggel, platformfüggetlen JavaScriptként. Az
  ESM-buktatókat (`banner` a CJS-függőségek `require`/`__dirname`-jéhez, minimális `package.json` a
  staging mappában) a [`scripts/bundle.mjs`](scripts/bundle.mjs) fejkommentje indokolja; a szkript
  ellenőrzi is, hogy a kész csomagban nincs `node_modules`, és elesik, ha van.
- **A csatolmány-letöltésnek felső mérethatára van** (`FLEX_MAX_DOWNLOAD_MB`, alap 50 MB; B11,
  WF13). Miért kell: a `client.download()` a választ teljes egészében memóriába olvassa (a Flex nem
  ad részleges letöltést), és a szerver a Claude Desktop alfolyamata — korlát nélkül egy nagy
  melléklet a beszélgetés közepén viszi el a folyamatot. A túllépés **hiba, nem csonkolás** (egy
  félig letöltött fájl rosszabb lenne). Az él-esetek: [`src/CLAUDE.md`](src/CLAUDE.md).
- **A verziót az `npm version` emeli, egy helyen** (WF13) — a README korábbi, kézi kétszeres
  verzióemelése (`package.json` **és** `manifest.json`) pontosan az az elsodródás, amit a `version`
  npm-hook kizár; a CI (`.github/workflows/ci.yml`) Node 20/22 mátrixon fut, `npm audit`-tal (WF12).
- **Az induláskori token-ellenőrzés opt-in, alapból kikapcsolva** (`FLEX_CHECK_ON_START`, WF19,
  P2-5) — egy alapból bekapcsolt hálózati hívás hálózatfüggővé tenné a `tools-list.test.ts`-t.
  Bekapcsolva a `checkTokenOnStart` (`src/tools/diagnostic.ts`) egyetlen `GET /diag`-ot hív, hibára
  **csak** stderr-figyelmeztet (a `formatError` szövegével) és **nem lép ki**: egy átmeneti hiba
  nem ok arra, hogy egy egyébként érvényes tokennel se induljon el a szerver.

## Nyitva maradt

- **Flex-oldali hibák a `/dms/news`-on (WF9, 2026-09-03):** `status: "all"` → HTTP 500, és a
  `pending`/`completed` bájtra azonos választ ad. MCP-oldalon nincs mit javítani; mindkettőt
  **kimondja a `flex_task_list` leírása**. Reprodukció:
  [`../flex-diag-hibajelentes.md`](../flex-diag-hibajelentes.md) 2. és 3. pontja.
- **P0-2**: a `/diag` végpont backend-oldali szűrése — a `../flex-diag-hibajelentes.md`-ben,
  elküldése a Flex csapatnak a felhasználó lépése. **P0-6 lezárva** (élő UI-egyeztetés,
  2026-09-03): a `MT_K` kötelezőséget jelent, nincs rá szükség hivatalos Flex-válaszra — a
  `flex-diag-hibajelentes.md` erről szóló kérdése törölhető, ha a jelentés még nincs elküldve.
- **A dátumjavítás írás-tesztje** (flex-dev, tesztfeladat) — a `datetime.test.ts` a konverziót Flex
  nélkül lefedi; ami hiányzik, az annak élő igazolása, hogy a Flex **tényleg** faliórát tárol.
- **A teljes Claude Desktop UX-mérés** (hívásszám/token, friss `.mcpb`-vel telepítve, 10 beszélgetés
  a [`../flex-mcp-eval/`](../flex-mcp-eval/) kérdéssorával): felhasználói lépés, nem futott le. A
  WF21 helyette az adatszintű reprodukálhatóságot igazolta (10/10, `meresek.md` 4. szakasza) — ez a
  `v1.0.0` kiadás gate-jéhez elég volt, de a Desktop-mérés önmagában továbbra is nyitott finomítás.

## Kapcsolódó

- [`../CLAUDE.md`](../CLAUDE.md) — a `DMS MCP` mappa áttekintése (K2 SOAP szerver, kiértékelési és
  megvalósítási terv)
- [`../flex-mcp-eval/`](../flex-mcp-eval/) — a szerver LLM-eval kérdéssora rögzített válaszokkal
  és a mérések. **Szándékosan a repón kívül**: élő sablonkódokat és lépésneveket tartalmaz, ez a
  repó pedig publikus
- [`../../Általános/flex-doc/`](../../Általános/flex-doc/) — a Flex felhasználói felületének
  dokumentációja
