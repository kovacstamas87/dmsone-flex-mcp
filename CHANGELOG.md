# Changelog

A jelölés a [Keep a Changelog](https://keepachangelog.com/) és a
[SemVer](https://semver.org/) ajánlásait követi.

## [1.0.0] – 2026-09-03

### Added
- **P2-5**: opt-in induláskori token-ellenőrzés (`FLEX_CHECK_ON_START`, alap `false`). Bekapcsolva
  a szerver induláskor egy `GET /diag`-ot hív (`checkTokenOnStart`,
  `src/tools/diagnostic.ts`); lejárt/érvénytelen tokenre stderr-figyelmeztetést ad a
  `formatError` szövegével, de **nem lép ki** — egy átmeneti hiba nem ok arra, hogy egy
  egyébként érvényes tokennel se induljon el a szerver. Alapból kikapcsolva, hogy a
  `tools-list.test.ts` és minden hálózat nélküli indítás hálózatmentes maradjon.
- **P2-2 / P2-3**: MCP **Resources** és **Prompts** (WF18). Három resource — `flex://templates`
  (elindítható sablonok), `flex://template/{id}` (egy sablon mezői, `ResourceTemplate` a `{id}`
  argumentum kiegészítésével) és `flex://my-tasks` (a folyamatban lévő teendők összefoglalója,
  ugyanazzal a projekcióval, mint a `flex_task_list`) —, valamint három vezetett prompt:
  `start-workflow`, `daily-summary`, `complete-task`. A promptok magyarul, a szerver
  `instructions`-ének fogalmaival vezetnek végig a lépéseken, és minden visszavonhatatlan lépés
  (indítás, lezárás) előtt jóváhagyást kérnek. A resource-ok mind csak-olvasók: mellékhatásos
  műveletnek nincs resource-változata.
- **P1-7 (áthelyezve)**: `templateId` **completion** (`completion/complete`) a
  `flex://template/{id}` resource `{id}` argumentumán és a `start-workflow` prompt `templateId`
  argumentumán. A javaslat értéke maga az azonosító (a kliens változatlanul írja be), a szűrés
  viszont a sablon nevére és kódjára is illeszkedik. A sablonlista 60 s-ig gyorsítótárazott, a
  resource-ok és a promptok között megosztva; Flex-hiba esetén a javaslat üres lista, nem
  protokollhiba. A tool-**paraméterekre** a spec ma sem ad completiont — ezt a kiértékelési terv
  S8 sora rögzíti.

### Changed
- **P2-1**: MCP TypeScript SDK **v1 → v2**: `@modelcontextprotocol/sdk@^1.30.0` helyett
  `@modelcontextprotocol/server@^2.0.0` (futásidő) és `@modelcontextprotocol/client@^2.0.0`
  (csak fejlesztéshez: tesztek, `scripts/sync-manifest.mjs`); `zod@^3.23.8` → `zod@^4.2.0`.
  A szerver továbbra is stdio-n fut, a 19 eszköz neve, címe, leírása, annotációi és a szerver
  `instructions` szövege **bájtra azonos** a migráció előttivel (snapshot-diff). Amit a kliens
  másképp lát, az a v2 SDK JSON Schema-dialektusa, azonos jelentéssel: `$schema` draft 2020-12,
  a kimeneti sémák `additionalProperties: {}` (`true` helyett), a bemeneti sémákon nincs
  `additionalProperties: false` (futásidőben mindkét verzió eldobja az ismeretlen kulcsot),
  `integer` mezőkön safe-integer `minimum`/`maximum`, a `metadata` rekordokon `propertyNames`,
  és eltűnt a v1-only `execution.taskSupport: "forbidden"` jelölés.
- Minden `inputSchema` explicit `z.object({...})` (a nyers shape a v2-ben deprecated), a
  kimeneti sémák `.passthrough()` helyett `.loose()`-t használnak (Zod 4).
- A `.mcpb` mérete 212 kB → **293 kB**: a v2 szerver Node-on AJV-t hoz a séma-validációhoz (287 kB),
  a Resources/Prompts felület további ~6 kB.
- Node 20+ marad a minimum (`engines`), a v2 csomagok is ezt írják elő.
- A tool-leírások költségvetése 4 500 → 4 700 karakter (mérve 4 619): a `flex_workflow_get_task_details`
  és a `flex_workflow_get_task_comments` leírása megnevezi az `<untrusted>` keretet. A szerver
  `instructions` 2 331 → 2 925 karakter (a megbízhatatlan tartalomról szóló bekezdés), majd
  **3 277** (WF18: a promptok és a resource-ok bemutatása).

### Security
- **P2-4 / B9**: a Flexből jövő, **felhasználó által írt** szövegek (feladatleírás, tárgy,
  megjegyzések, `Text`/`Textarea` metaadat-értékek) jelölten mennek a modellnek: a `text`
  csatornán `<untrusted source="flex:útvonal">…</untrusted>` keretben, HTML-ből szöveggé alakítva
  (`src/untrusted.ts`, zéró függőség), a `structuredContent`-ben puszta szövegként plusz
  `untrustedFields` útvonal-listával. A keret belülről nem hamisítható (a tartalomban álló
  `<untrusted`/`</untrusted` escape-elt, az entitás-dekódolás *után*), csonkolásnál a nyitva maradt
  keret lezárul a csonkolás-megjegyzés előtt. A szerver `instructions`-e kimondja: a keret tartalma
  adat, nem utasítás. Érintett eszközök: `flex_workflow_get_task_details`, `_get_task_comments`,
  `_add_task_comment`, `flex_task_comment`, és a két listázó (`subject`/`wfSubject`; `fields: "full"`
  esetén a teljes elem, a HTML-leírás szöveggé alakítva).

### Eval (P2-7)
- A `../flex-mcp-eval/evaluation.xml` 10 kérdése **újrafuttatva** (WF21, 2026-09-03) élő, read-only
  hívásokkal: **10/10 helyes**, a flex-dev adatok (sablon-metaadat, lezárt munkafolyamat-feladatok,
  felhasználó) a WF14 óta nem drifteltek — a Q7 verzió-őr (`flex_ux` sablon) is változatlanul 13-on
  áll. Részletek: `../flex-mcp-eval/meresek.md`.
- **Injection-teszt:** az automatizált tesztkészlet fixture-e (`Flex/test/untrusted.test.ts`,
  `Flex/test/handlers.test.ts`) egy szó szerinti „Ignore previous instructions…" szöveget futtat át a
  `<untrusted>` kereten — a szöveg a kereten belül, escape-elve marad, nem generál se
  tool-hívást, se protokoll-szintű mellékhatást. `npm test`: **214/214 zöld**, ebben az
  injection-fixture is. Ez a live-QA formátumban nem reprodukálható (a flex-dev-en nincs, és nem is
  hozunk létre írással ilyen tartalmú éles adatot) — az automatizált teszt a hitelesebb, ismételhető
  forrás.
- A teljes **Claude Desktop UX-mérés** (hívásszám/token, a friss `.mcpb`-vel telepítve) — mint a
  v0.1.1/v0.2.0 esetén — felhasználói lépés marad; a statikus költség (`tools/list` + `instructions`)
  és a válasz-payload méréseit lásd `../flex-mcp-eval/meresek.md`.

## [0.2.0] – 2026-09-03

### Added
- **P1-1**: a két listázó eszköz (`flex_task_list`, `flex_workflow_get_my_tasks`) lapoz és
  alapból összefoglalót ad — `limit` (1–100, alap 20), `offset`, `fields: "summary" | "full"`,
  egységes boríték (`{ total, offset, returned, hasMore, fields, items }`).
- **P1-4**: `flex_workflow_get_template_details` `includeRaw` paramétere (alap `false`) — a
  normalizált `fields` mellett a teljes `raw` csak kérésre jön vissza.
- **P1-2**: `outputSchema` öt szerver-épített válaszon (`flex_diag`, `flex_task_list`,
  `flex_workflow_get_my_tasks`, `flex_workflow_get_template_details`,
  `flex_workflow_download_attachment`) — szándékosan laza séma, lásd `src/schema.ts`.
- **P1-8/P1-9**: minőség-infrastruktúra — eslint (flat config) + Prettier, `tsc --noEmit`,
  handler-tesztek egy fake `FlexHttp` klienssel (`test/handlers.test.ts`), CI Node 20/22
  mátrixon `npm audit`-tal, heti Dependabot.
- **P1-10**: a `.mcpb` egyfájlos esbuild-bundle-ből készül, `node_modules` nélkül.
- **P1-11**: `manifest.json` `manifest_version: "0.3"`, `repository`/`homepage`/`documentation`/
  `support` mezőkkel.
- **P1-14**: LLM-eval kérdéssor rögzített válaszokkal (`../flex-mcp-eval/evaluation.xml`,
  10 read-only kérdés) — a `../flex-mcp-eval/CLAUDE.md` írja le a futtatás módját. A tool-leírások
  fix, munkamenetenkénti terhe mérve: **4 484 karakter** (11 936-ról, −62 %), `initialize`
  `instructions` 2 331 karakter, a teljes `tools/list` JSON 25 996 karakter. A `startDetails/66`
  válasza `includeRaw` nélkül 2 304 karakter az 5 370 helyett (−57 %); a `/dms/news` egy 21 elemes
  hívása 70 645 karakterről 7 312-re (−89,6 %) csökkent. A tíz kérdés két Claude Desktop-mérése
  (v0.1.1 vs. ez a kiadás) **felhasználói lépés, még nem futott le** — a kérdéssor és a mérőtábla
  készen áll a `../flex-mcp-eval/meresek.md`-ben.

### Changed
- **Áttörő változás a hívó modellnek**: a `performerOrgId` (`flex_task_create`) és a
  `responsibleOrgId` (`flex_workflow_start`) mostantól **kötelező** — korábban meg nem adva
  csendben `1`-re esett vissza, ami rossz szervezeti egységhez rendelt feladatot okozhatott
  észrevétlenül (P1-5/P1-6).
- **P1-3**: tömör tool-leírások — a „Bemenet:/Visszatérés:" blokkok kikerültek, a
  paraméter-magyarázat a Zod `.describe()`-ba, a válasz alakja az `outputSchema`-ba került.
- A két listázó eszköz **alapértelmezett módja `summary`**, nem a Flex nyers válasza — a részletet
  a részletező eszközök adják.
- `flex_task_list` minden eleme explicit `idKind`-ot (`"taskId"` / `"wfTaskId"`) is ad, hogy a
  modellnek ne kelljen a `type` mezőt eszköznévre fordítania.
- A verzió emelése egyetlen paranccsal (`npm version`) történik — a README „Kiadás készítése"
  fejezete a korábbi kézi, kétszeres verzióemelésről erre javítva.

### Fixed
- `toolJson` mostantól a `structuredContent`-et is csonkolja az 50 000 karakteres korlát fölött,
  nem csak a `text`-et — korábban a kliens a csonkolatlan `structuredContent`-et is megkapta.
- A `flex_user_get_by_username` leírása és a hozzá mutató `orgId` paraméterek javítva: a
  `/dms/ac/user` **nem ad** `orgId`-t (élő mintavétel, WF14), a korábbi leírás mégis oda küldte a
  modellt. A leírás most a valódi forrást (`flex_task_list` `orgId` mezője, illetve
  `wfDetails.responsibleUser.orgId`) mondja, és jelzi az ékezet-érzékeny keresést.

### Security
- **B11**: a csatolmány-letöltésnek felső mérethatára van (`FLEX_MAX_DOWNLOAD_MB`, alap 50 MB) —
  a `client.download()` korábban korlát nélkül olvasott memóriába; a túllépés hiba, nem csonkolás.

## [0.1.1] – 2026-09-02

### Security
- **P0-1**: `flex_diag` a `/diag` válaszából mostantól csak a `method`/`uri`/`qs` mezőt adja
  vissza — a Bearer tokent és a backend env-változóit tartalmazó `req`/`server`/`cookies` blokkok
  eldobva.
- **P0-3**: a csatolmány-letöltés (`flex_workflow_download_attachment`) `savePath`-ja és a
  szerver adta fájlnév mostantól sandboxolt — csak a letöltési könyvtár (`FLEX_DOWNLOAD_DIR`,
  alapból az OS temp `dmsone-flex` almappája) alá írhat, meglévő fájlt nem ír felül.
- **P0-4**: az eszköz-annotációk a valós viselkedést tükrözik — `download_attachment`
  `readOnlyHint: false`/`idempotentHint: false`; `complete_task`, `task_complete`,
  `workflow_start` `destructiveHint: true`.
- **P0-7**: minden tool-eredmény (és a hibaüzenetek törzse) egy központi redakciós szűrőn megy
  át, ami kulcs- és érték-alapon is kiszűri a token-szerű adatokat; a hibatörzs 2 000 karakterre
  csonkol.
- **P0-8**: `FLEX_IGNORE_SSL` induláskor stderr-figyelmeztetést ad, és a publikus
  `flex.dmsone.hu` URL-en hibával megtagadja az indulást.

### Fixed
- **P0-5**: `formatDateTime` a Flex felé menő dátumokat mostantól helyi falióraként kezeli, nem
  konvertál UTC-re — a korábbi viselkedés nyári időszámításkor két órával korábbra tolta a
  megadott határidőket.
- **P0-6**: a kötelező-mező validáció nyíltan best-effort — csak akkor fut, ha a sablon mezői
  ténylegesen hordoznak `required`/`mandatory` jelölést (`validation: "api-flag" | "none"` a
  `flex_workflow_get_template_details` válaszában).
- **P0-9**: PAT hitelesítési mód mellett megadott impersonáció esetén stderr-figyelmeztetés
  (a PAT módban az impersonáció nem érvényesül).

### Changed
- **P0-10**: `@modelcontextprotocol/sdk` `^1.30.0`, `axios` `^1.20.0`, `npm audit fix` — 0
  high/moderate találat; `engines.node >=20`.
- **P0-11**: a szerver verziója egyetlen forrásból (`package.json`) származik; a
  `manifest.json` verziója generált (`scripts/sync-manifest.mjs`).
- Új tesztkeret (`node:test` + `tsx`, `npm test`), CI-ba kötve.
- Új `FLEX_TIMEZONE` konfiguráció (alap `Europe/Budapest`) a dátumkonverzióhoz.

## [0.1.0] – 2026-06-29

### Added
- Első kiadás: lokális (stdio) MCP szerver a DMS One Flex REST API-hoz.
- 19 eszköz négy erőforráshoz:
  - **Task:** create, comment, accept, complete, list
  - **User:** get_by_username
  - **Workflow:** list_templates, get_template_details, start, get_my_tasks,
    get_task_details, complete_task, get_task_comments, add_task_comment,
    get_task_attachments, get_task_related_attachments, download_attachment,
    search_linked_items
  - **Diagnostic:** diag
- Hitelesítés: Personal Access Token és Station Token (opcionális impersonációval).
- Szerver-szintű `instructions` (domain-térkép a modellnek) és normalizált
  sablon-mező felfedezés (`get_template_details` → `fields`).
- `.mcpb` telepítőcsomag (Claude Desktop, platformfüggetlen).
- Telepítési útmutatók: Windows és macOS (lépésről lépésre + használat).
