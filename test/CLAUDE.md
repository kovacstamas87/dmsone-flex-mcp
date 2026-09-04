# test — a Flex MCP szerver tesztjei

`node:test` + `node:assert/strict`, közvetlenül a `src/` TypeScript forrásból futtatva `tsx`-szel:

```bash
npm test          # node --import tsx --test test/*.test.ts
```

A `tsconfig.json` `include`-ja `src/**/*` marad, ezért a `test/` **nem** kerül a `dist`-be és a
`.mcpb` csomagba. A CI (`.github/workflows/ci.yml`) a build után futtatja.

## Fájl-leltár

| Fájl | Mit fed le | Mikor keletkezett |
|---|---|---|
| `smoke.test.ts` | Füst-teszt: a `formatError` egy `Error`-ra `Hiba: …`-t ad — azt igazolja, hogy maga a keret fut | WF1 |
| `sync-manifest.test.ts` | A `scripts/sync-manifest.mjs` idempotens, és a `manifest.json` verziója a `package.json`-t követi. **WF10-ben**: a teszt előbb **fordít** (`npm run build`), majd a `manifest.tools` névlistáját a lefordított szerver `tools/list`-jéhez méri, és a generált leírásokat is ellenőrzi (egysoros, < 200 karakter) | WF1, WF10 |
| `redact.test.ts` | `src/redact.ts`: kulcs- és érték-alapú szűrés, a valós Flex-mezők érintetlensége, másolat-szemantika, ciklusvédelem, a bejelentett literális titok | WF2 |
| `format.test.ts` | `src/format.ts`: a `toolJson` a `text`-et és a `structuredContent`-et is redaktálja; a hibatörzs 2 000 karakterre csonkol; a hibaüzenetek szövege változatlan. **WF9-ben**: nagy válasznál a `structuredContent` **is** csonkolt (`truncated`/`originalChars`/`note`), a limit alatti válasz viszont érintetlen. Plusz a **megkerülés-őr** (lásd lent) | WF2, WF9 |
| `diag.test.ts` | `src/tools/diagnostic.ts` `pickDiagFields()`: a `/diag` válaszából csak `ok`/`method`/`uri`/`qs` marad, mindkét válaszalakra | WF2 |
| `paths.test.ts` | `src/paths.ts`: `sanitizeFileName` (traversal, `.`/`..`, fenntartott nevek, tiltott karakterek, 200 kódpont, idempotencia), `resolveDownloadPath` (engedett/tiltott `savePath`-ok posix **és** win32 alakban, `a/b/../c` engedett), `ensureDirInside` (symlink-kiszökés elutasítva, macOS `/var` symlinkes temp átmegy) és `uniquePath` valódi temp-könyvtárban, plusz a teljes lánc (`resolve → ensureDir → unique → wx`) | WF3 |
| `tools-list.test.ts` | A szervert **valódi stdio-transzporton** indítja (`node --import tsx src/index.ts`, dummy token), és a `tools/list` választ nézi: 19 eszköz, a négy WF3-annotáció, a read-only eszközök következetessége, a letöltés leírása nem ígér tetszőleges útvonalat; **WF4-ben**: a sablon-részletek leírásából eltűnt a „MINDIG", az indítás leírása kimondja a best-effortot, a dátumos eszközök megnevezik a falióra-szemantikát és a `FLEX_TIMEZONE`-t; **WF9-ben**: a két listázó leírása kimondja a lapozást és az összefoglaló alapértelmezést, a séma tartalmazza a `limit`/`offset`/`fields` mezőt (`limit` alapértelmezése 20), a feladatlista megmondja, mi marad ki és hogy a lista vegyes, a sablon-részleteknél az `includeRaw` alapból hamis; **WF10-ben**: az összleírás < 4 500 karakter, az `outputSchema` pontosan az öt szerver-épített válaszon van (és máshol nem), és minden séma laza (`additionalProperties: true`, `required` nélkül) — az `includeRaw`-őr pedig a paraméter `.describe()`-jét nézi, mert oda került az ígéret; **WF11-ben**: a feladatlista leírása az `idKind`-re (nem csak a `type`-ra) mutat, és a `responsibleOrgId`/`performerOrgId` mezőknek nincs `default`-juk a `tools/list` sémájában; **WF14-ben**: a két `orgId` paraméter a `flex_user_get_by_username` *leírására* mutat és nem a válaszára (a hamis „válaszának orgId" szöveg tilos), a felhasználó-kereső leírása pedig kimondja, hogy orgId-t nem ad, megnevezi a valódi forrást, és jelzi az ékezet-érzékenységet; **WF20-ban**: a kliens a `@modelcontextprotocol/client` (v2) csomagból jön, és a laza-séma-őr a passthrough **két ekvivalens** JSON Schema-írásmódját fogadja el (`additionalProperties: true` — Zod 3 / v1 SDK, vagy `{}` — Zod 4 / v2 SDK), a `false`-t és a hiányt nem; **WF18-ban**: a stdio-n indított szerver a `resources/list`, `resources/templates/list` és `prompts/list` felületet is hirdeti, és az `instructions` megnevezi őket; **WF17-ben**: a költségvetés 4 700, a `flex_workflow_get_task_details` és `_get_task_comments` leírása megnevezi az `<untrusted>` keretet, a szerver `instructions`-e (`client.getInstructions()`) kimondja, hogy a keret tartalma adat, nem utasítás, és megnevezi az `untrustedFields`-et | WF3, WF4, WF9–WF11, WF14, WF17, WF18, WF20 |
| `datetime.test.ts` | `src/format.ts` `formatDateTime` és a `FLEX_TIMEZONE` konfigurációja: offsetes bemenet átszámítása CET/CEST-re, offset nélküli falióra változatlansága, csak-dátum, éjfél `00`-ként, a mintára illő de nem létező időpontok elutasítása, zóna-visszaesés elírt `FLEX_TIMEZONE`-nál | WF4 |
| `template.test.ts` | `src/tools/workflow.ts` sablon-feldolgozása: `parseTemplateFields` `requiredMarkerPresent`-je (`required`/`mandatory`, a kulcs jelenléte vs. értéke), `describeTemplate` `validation` + `note` mezője, `missingRequiredMessage` best-effort viselkedése; **WF9-ben**: a `raw` alapból kimarad, `includeRaw`-val jön vissza; **2026-09-04 (v1.0.3)**: `missingDeadlineMessage` — megadott határidőnél nincs kifogás, hiányzónál a sablon javaslata **dátumként** (nem időpontként) jelenik meg és a Flex saját üzenetét idézi, javaslat nélküli sablonnál is használható szöveg jön, plusz a `describeTemplate` `suggestedDeadline` mezője; **2026-09-04**: az Option lehetőségek `{ code, label }` párok (a kód a `params` 1-alapú sorszáma), és a `resolveOptionValues` kód/címke-feloldása (címke → kód, kis/nagybetű és térköz tűrve, számot ábrázoló címkénél a kód-értelmezés győz, ismeretlen értékre hiba a lehetőségekkel); **2026-09-03 (P0-6 lezárása)**: `visibilityMarkerPresent` és a `visibility-flag` ág (`MT_K` kötelező, `MT_M` nem, explicit kulcs hiányában), a `"none"` ág immár csak a *semmilyen* jelölés nélküli sablonra vonatkozik | WF4, WF9, P0-6 |
| `config.test.ts` | `src/config.ts` `validateConfig`: üres token, SSL-kikapcsolás publikus vs. fejlesztői URL-en, PAT+impersonáció, több hiba/figyelmeztetés egyszerre, érvénytelen `baseUrl`. **WF19-ben**: `loadConfig().checkOnStart` a `FLEX_CHECK_ON_START` `truthy()`-értékein (hiányzó/üres → `false`, `1`/`true`/`yes`/`on` case-insensitive → `true`, `0`/`false`/`no`/`off` → `false`) | WF5, WF19 |
| `projection.test.ts` | `src/projection.ts`: a summary kulcskészlete és az, hogy HTML / `metaItems` / kommentek / csatolmányok **nincsenek** benne; a vegyes Task+WfTask lista; a `templateName` lapítása; `paginate` szélei (túlfutó és negatív `offset`, üres lista, `hasMore`); az `envelope` mezői, a `full` mód és a nem-tömb `result` átengedése. A **21 elemes fixture summary-ja < 8 KB** kész-kritérium is itt van lefogva. **WF11-ben**: az `idKind` a `type`-ból helyesen származik (`WfTask` → `wfTaskId`, minden más → `taskId`) | WF9, WF11 |
| `schema.test.ts` | `src/schema.ts` öt `outputSchema`-ja **valós alakú** válaszokon: a szűrt `/diag`, a sablon-részletek `visibility-flag` (2026-09-03-tól, korábban `none`) és `includeRaw` ága, a letöltés nyugtája (`contentType` nélkül is), a két listázó boríték `summary` és `full` módban, a nem-tömb `result` fallbackje, és a `toolJson` csonkolás-ága mindegyik sémán. A kérdés nem az, hogy a séma szigorú-e, hanem hogy **soha ne bukjon** — mert az SDK-validáció bukása élesben elszállasztja a hívást | WF10, P0-6 |
| `fixtures/task-list.json` | A `/dms/news` élő, read-only mintája (21 elem), **anonimizálva** | WF9 |
| `fixtures/wf-tasks.json` | A `/dms/wfTasks/my` alakja (25 elem) a lapozás széleihez | WF9 |
| `handlers.test.ts` | A `register*Tools` handlerei egy fake `FlexHttp` kliensen (lásd `src/client.ts`), a valódi MCP-protokollon át (`InMemoryTransport` + `Client.callTool`, nem a `registerTool` belső callback-je): `flex_task_list` (summary/full/limit), `flex_workflow_get_my_tasks`, `flex_workflow_get_template_details` (`includeRaw` mindkét ága), `flex_workflow_download_attachment` (sandbox-lánc: mentés, könyvtár fölé mutató `savePath` elutasítása, ütközésnél `-1` utótag) fake bufferrel. **WF20-tól** az `InMemoryTransport` a `@modelcontextprotocol/server`-ből jön (a `McpServer`-rel együtt): a v2-ben a szerver- és a kliens-csomag **külön példányt** hordoz belőle, és egy linked pair két fele csak ugyanabból az importból jöhet. **WF17-ben**: a `flex_workflow_get_task_details` fake válaszán a `text` keretez (injection-fixture a kereten belül), a `structuredContent` puszta szöveg + `untrustedFields`; a `flex_task_list` summary `subject`-je keretezett és az `outputSchema` átengedi az `untrustedFields`-et; `full` módban a HTML leírás szöveggé alakul, a többi mező a nyers elem. **2026-09-04-től** a „kimenő törzs" blokkok (a `startWith` alapértelmezésében ezért van `deadline`: nélküle minden eset a határidő-ellenőrzésen bukna, és az elfedné a törzs-vizsgálatot) — határidő nélkül a Flexet meg sem hívjuk: a `flex_workflow_start` törzsében a `linkedItem`/`files`/`description`/`deadline` üres értékkel is ott van, kapcsolt elemnél `{ id, type }`, fél kapcsolt elemre nem megy kérés, az Option címke kódra fordul (érvénytelenre hibaüzenet a lehetőségekkel), a `deadline` `YYYY-MM-DD`, a csatolmány típuskódja átmegy; a `flex_task_create` törzsében a `taskPerformers.organizationCodes` üresen is kimegy | WF12, WF17, WF20, 2026-09-04 |
| `client.test.ts` | `src/client.ts` letöltési méretkorlátja **valódi HTTP-n** (helyi `node:http` szerver): a korlát alatti fájl átmegy, `Content-Length`-szel és **`Content-Length` nélkül, chunkolva** is elesik (`DownloadTooLargeError`), a hiba a tool-válaszban magyarul jelenik meg; plusz a `formatError` nyers-axios tartaléka és a `FLEX_MAX_DOWNLOAD_MB` feloldása (üres, törtszám, nulla/negatív/nem szám → alapértelmezés) | WF13 |
| `untrusted.test.ts` | `src/untrusted.ts`: a `htmlToText` él-esetei (a fixture HTML-leírása, `<br>`/`<li>`/blokk/cella, script+style+komment a tartalmával együtt ki, nevesített/decimális/hexa entitás és magyar ékezet, érvénytelen entitás marad, `&lt;b&gt;` szövegként marad — nincs dupla-dekódolás, attribútumban álló `>`, sima szöveg csak whitespace-normalizált, lezáratlan tag); a keret hamisíthatatlansága (belső záró/nyitó jelölő escape-elve, kis/nagybetű megőrizve, entitásként beírt záró jelölő sem nyílik ki); `markUserContent` a fixture-ön (útvonalak tömbindex nélkül, rendszer-mezők érintetlenek, `Text`/`Textarea` metaadat jelölt, `Number`/`Option` nem, üres/nem-string érintetlen, másolat); a `toolJson` két csatornája (keret + injection-fixture a kereten belül a `text`-ben, puszta szöveg + `untrustedFields` a `structuredContent`-ben, redakció a kereten belül, marker nélküli válasz azonos hivatkozás); csonkolt keret lezárása | WF17 |
| `resources-prompts.test.ts` | A **WF18** felülete a valódi protokollon (`InMemoryTransport` + fake `FlexHttp`): `resources/list` (a két statikus URI) és `resources/templates/list`; a három `resources/read` tartalma (sablonlista, sablon-mezők `validation`-nel és `raw` nélkül, a `my-tasks` summary-borítéka keretezett `subject`-tel); a nem szám sablon-azonosító **Flex-hívás nélkül** magyar hibát ad; a Flex hibája magyar protokollhibaként jelenik meg; `completion/complete` a resource- és a prompt-argumentumon (id-prefix és név szerinti szűrés, **egy** Flex-hívás négy javaslatra a megosztott gyorsítótár miatt, hibánál üres lista); `prompts/list` (három prompt, csupa opcionális argumentum) és `prompts/get` (a megadott argumentum bekerül, a jóváhagyás-kérés és a helyes eszköznevek benne vannak) | WF18 |
| `manifest.test.ts` | A `manifest.json` **ember által írt** része: `manifest_version` 0.3, minden `mcp_config.env` hivatkozás létező `user_config` kulcsra mutat, a metaadat-URL-ek a valódi repóra, a verzió a `package.json`-nal egyezik | WF13 |
| `debug.test.ts` | `src/debug.ts`: `FLEX_DEBUG` nélkül néma; bekapcsolva egyetlen stderr-sor a törzzsel, benne a `null` kulcsokkal (pont azokat keressük), a csatolmány base64 tartalma nélkül | 2026-09-04 |
| `startup.test.ts` | `src/tools/diagnostic.ts` `checkTokenOnStart(client)`: sikeres `GET /diag`-nál nincs stderr-kiírás; hibázó hívásnál **egyetlen** figyelmeztetés (`FLEX_CHECK_ON_START` a szövegben, a `formatError` üzenete benne), és a hívás **nem dob** — fake `FlexHttp`-vel, hálózat nélkül | WF19 |

## Rögzített szabályok

- **Valós titok nem kerülhet tesztfájlba.** A redakciós tesztek *kitalált* tokennel és
  `APP_KEY`-jel dolgoznak; a fixture-ökben a **szerkezet** a lényeg (a `/diag` `req` / `cookies` /
  `server` burkolói), nem a konkrét érték.
- **A `fixtures/` alatti minták élő, read-only hívásból származnak, anonimizálva.** Provenance:
  a `task-list.json` a fejlesztői rendszer `GET /dms/news?status=in-progress` válasza
  (2026-09-03, 21 elem, eredetileg 70 645 karakter, anonimizálva 61 550); a `wf-tasks.json` a `GET /dms/wfTasks/my`
  alakját követi (az élő válasz 137 eleméből 25, hogy a `limit: 20` széle tesztelhető legyen).
  **Kicserélve:** minden ember által írt vagy üzleti tartalmat hordozó szöveg — tárgyak, leírások,
  megjegyzések, személynevek, fájlnevek, **sablonnevek és -kódok, munkafolyamat-lépések nevei,
  metaadat-mezők kódjai és címkéi, opciólisták, lehetséges eredmények**. **Megtartva:** a
  kulcsnevek, a beágyazás, a mennyiségek, a mezőtípusok (`Text`, `Option`, `Money`, `Partner`…) és
  az enum-értékek (`FA_U`, `MT_K`, `Task`/`WfTask`), valamint az, hogy a leírás **HTML**-t
  tartalmaz — a projekció épp ezekre a szerkezeti tényekre épül, az üzleti címkékre nem.
  **Miért ilyen szigorúan:** a repó **publikus**, és a sablon- és mezőnevek a DMS One belső
  folyamatait írnák le. Ha új fixture kell, ugyanígy: élő read-only hívás, anonimizálás, majd a
  maradék string-értékek átnézése (`jq -r '[.. | strings] | unique | .[]'`); írás-teszt a Flexbe
  nem megy.
- **A tesztek a `src/`-ből importálnak, `.js` kiterjesztéssel** (`../src/redact.js`) — ez az ESM +
  `NodeNext` modulfeloldás követelménye, a `tsx` a `.ts` forrást tölti be helyette.
- **A `format.test.ts` végén álló „megkerülés-őr" forrás-szintű teszt**, nem futásidejű: azt
  ellenőrzi, hogy a `src/tools/` alatt nincs kézzel összeállított tool-eredmény
  (`content: [ … ]`, `structuredContent`, `isError`). Miért így: a titok-redakció egyetlen
  beépítési pontja a `format.ts` `toolJson`/`toolError`-e, és ezt csak úgy lehetne megkerülni, ha
  valaki egy új eszközben maga állítja össze a választ — ez pedig nem hiba, amit egy hívás
  kimutatna, hanem szerkesztési tévedés, amit csak a forrás olvasásával lehet elkapni.
  A `content:` minta szándékosan `content:\s*\[` — a `workflow.ts` csatolmány-**kérésében** van egy
  jogos `content:` mező, az bemenet, nem eredmény. A `src/resources.ts` read-callbackjei szintén
  kézzel építik a `contents` tömböt (a `resources/read` alakja ez), de a **szöveg** mindig a
  `resourceJson`-ból jön — ugyanabból a redakciós láncból, mint a tool-eredmények.
- **A leírás-ellenőrzések a `tools-list.test.ts`-be tartoznak, nem a unit-tesztekbe.** Miért: a
  tool-leírás akkor őszinte vagy hamis, amikor a **modell** olvassa — az pedig a `tools/list`
  válasza, nem a forrásfájl egy stringje. A WF4 két kész-kritériuma („a leírás nem ígér többet,
  mint amit tesz") így a protokollon át van lefogva.
- **Az akcentus a Hungarian szótőnél elmozdul** (`falióra` → `faliórát` / `faliórája`), ezért a
  szövegellenőrző regexek a **szótőre** illeszkednek (`/faliór/`), nem a szótári alakra.
- **A séma-tesztek a `toolJson`-on át validálnak, nem a nyers objektumon.** Miért: az SDK a
  `structuredContent`-et validálja, azt pedig a `toolJson` állítja elő — a redakcióval és a
  méretkorláttal együtt. A nyers objektum validálása zöld lenne akkor is, ha a csonkolás-ág
  élesben elszállasztja a hívást.
- **A `.mcpb` tartalmát nem teszt őrzi, hanem a `scripts/bundle.mjs` maga**: a csomagolás után
  `unzip -l`-lel ellenőrzi, hogy nincs `node_modules` bejegyzés, és hibával elesik, ha van. Miért
  nem `*.test.ts`: a bundle előállítása másodpercekig tart, és a `npm test` így hálózat- és
  build-mentes marad; a szerződés ott a leghasznosabb, ahol keletkezik.
- **A `handlers.test.ts` fake klienst ad át, nem HTTP-t mockol.** A `register*Tools` a `FlexHttp`
  interfészen (`src/client.ts`) keresztül lát klienst — egy `{ request, download }` alakú objektum,
  amit egy `nock`-szerű könyvtár helyett egy plain objektum is kielégít: rögzített választ ad vagy
  hibát dob, a hívás URL-jét/metódusát pedig a teszt maga `assert.equal`-lel ellenőrzi. Miért nem
  HTTP-mock: az axios-hívás sosem történik meg, tehát nincs mit elfogni — a mock-könyvtár saját
  URL-illesztési szabályai (path-paraméterek, query-sorrend) így nem okozhatnak hamis pirosat vagy
  hamis zöldet. A tool-hívás maga a valódi MCP-protokollon megy át (`InMemoryTransport` +
  `Client.callTool`), így a Zod-validáció és az `outputSchema`-ellenőrzés is lefut, ugyanúgy, mint
  élesben — csak a folyamat nem hagyja el a Node-példányt, ahogy a `tools-list.test.ts` teszi.
- **Nincs Flex-hívás a tesztekben.** A tesztek tiszta függvényeket fednek le; élő ellenőrzés a
  kiadási munkafolyamatban (WF7) történik, Inspectorral vagy újratelepített `.mcpb`-vel.
  Kivétel-nélküli szabály, nem tiltás a HTTP-re: a `client.test.ts` **saját** `node:http` szervert
  indít localhoston. Miért ott mégis: a méretkorlát az axios `maxContentLength`-je, tehát azt kell
  látni, hogy az adapter valóban elvágja a választ — egy fake `FlexHttp` ezt megkerülné, mert ott a
  `download()` implementációja nem is fut le. Flexet ez sem hív.
  A `tools-list.test.ts` ugyan elindítja a szervert, de a `tools/list` nem hív Flexet — ezért
  elég a dummy token, és hálózat nélkül is fut.
- **A séma-őrök jelentést ellenőriznek, nem az SDK JSON Schema-írásmódját** (WF20). Az SDK v2
  (Zod 4 `z.toJSONSchema`) máshogy írja le ugyanazt, mint a v1 (`zod-to-json-schema`):
  `additionalProperties: {}` a `true` helyett, 2020-12 `$schema`, `.int()` safe-integer határok,
  `z.record` `propertyNames`. Egy őr, ami ezek egyikét szó szerint rögzíti, egy SDK-frissítésnél
  hamis pirosat ad — ezért a passthrough-őr mindkét ekvivalens alakot fogadja. A migráció valódi
  bizonyítéka nem teszt, hanem a WF20 előtti/utáni `tools/list` snapshot-diffje (lásd
  [`../CLAUDE.md`](../CLAUDE.md)).
- **A `tools-list.test.ts` a protokollon át néz, nem a forrásban.** Miért: az annotációk azért
  vannak, hogy a *kliens* lássa őket — egy `registerTool`-hívás olvasása nem bizonyítja, hogy a
  kliens ugyanazt kapja. Ez a teszt egyben az Inspector `tools/list` snapshot (WF7 3. pont)
  hálózat nélküli előképe.
- **A fájlrendszert érintő tesztek (`paths.test.ts`) `mkdtemp`-pel dolgoznak és takarítanak.**
  Sosem írnak a repóba vagy a valós letöltési könyvtárba; a symlink-teszt egy második temp-könyvtárra
  mutat, és azt is ellenőrzi, hogy oda nem került fájl.

## Kapcsolódó

- [`../CLAUDE.md`](../CLAUDE.md) — a szerver áttekintése, kulcsdöntések
- [`../src/CLAUDE.md`](../src/CLAUDE.md) — a tesztelt forrás fájl-leltára
