# src — a Flex MCP szerver forráskódja

TypeScript forrás, `tsc`-vel fordítva `dist/`-be (`npm run build`). Belépési pont: `index.ts`.

## Fájl-leltár

| Fájl | Mi ez |
|---|---|
| `index.ts` | Belépési pont: konfiguráció betöltése, **WF19-től** opt-in `checkTokenOnStart(client)` hívás (`config.checkOnStart` esetén, a `McpServer`-létrehozás előtt), `McpServer` létrehozása (stdio transzport — **WF20-tól** `@modelcontextprotocol/server` és `…/server/stdio`, a v1 `sdk/server/mcp.js` helyett), a négy `register*Tools` hívása, majd **WF18-tól** a megosztott sablon-gyorsítótár (`createTemplateCache`), a `registerResources` és a `registerPrompts`. A szerver-szintű `SERVER_INSTRUCTIONS` (magyar, a modellnek szóló "térkép") is itt van. A `version` mezőt a `package.json`-ból olvassa (`createRequire`) — lásd [`../CLAUDE.md`](../CLAUDE.md) „Kulcsdöntések". |
| `config.ts` | `loadConfig()` — env változókból (`FLEX_*`) épít `FlexConfig`-ot; a `truthy()` helper a boolean env-parsinghoz. A `downloadDir` **abszolút** (`path.resolve`), mert ez a letöltés sandbox-határa. A `timeZone` (`FLEX_TIMEZONE`, alap `DEFAULT_TIME_ZONE` = `Europe/Budapest`) IANA zónanév; a `resolveTimeZone()` **induláskor egyszer** validálja az `Intl`-lel, és elírás esetén stderr-figyelmeztetéssel visszaesik az alapértelmezettre. A `maxDownloadBytes` (`FLEX_MAX_DOWNLOAD_MB`, alap `DEFAULT_MAX_DOWNLOAD_MB` = 50) a csatolmány-letöltés felső határa; a `resolveMaxDownloadBytes()` a nulla/negatív/nem szám értéket is az alapértelmezésre hozza, hangosan. **WF19-től** a `checkOnStart` (`FLEX_CHECK_ON_START`, `truthy()`-vel olvasva, alap `false`) mondja meg, fusson-e induláskor egy `/diag`-hívás. `validateConfig(config)` — üres token, publikus URL-en kikapcsolt SSL → hiba; fejlesztői URL-en kikapcsolt SSL, PAT+impersonáció → figyelmeztetés; nem lép ki és nem ír stderr-re, ezt a hívó (`index.ts`) dönti el. |
| `paths.ts` | A letöltés útvonal-logikája, tiszta függvényekben: `sanitizeFileName` (szerver-fájlnév és GUID tisztítása), `resolveDownloadPath` (a `savePath` feloldása a letöltési könyvtár alá, vagy hiba), `ensureDirInside` (szülőkönyvtár létrehozása + `realpath`-ellenőrzés symlink ellen), `uniquePath` (`-1`, `-2`… utótag). A fejkomment írja le, miért mindkét platform (posix **és** win32) szabályait alkalmazza. |
| `client.ts` | `FlexHttp` — a `request`/`download` felület, amit a `tools/*.ts` lát; `FlexClient` ennek axios-alapú megvalósítása (auth fejlécek, base URL, SSL-figyelmen-kívül-hagyás). **WF12-től** a `register*Tools` a `FlexHttp`-t kapja, nem a konkrét osztályt — ez teszi lehetővé a fake klienses handler-teszteket (`test/handlers.test.ts`). | **WF13-tól** a `download()` `maxContentLength`-et állít (`config.maxDownloadBytes`), és a túllépést `DownloadTooLargeError`-rá fordítja — magyar, cselekvésre fordítható üzenettel, az axios angol bájtszáma helyett. |
| `format.ts` | `toolJson` / `toolError` / `formatError` — minden tool eredménye ezen megy át; a hibaüzenetek magyarul, HTTP-státusz szerint kategorizálva. A `toolJson` **redaktál, majd szerializál**, és **WF17-től** a `text`-et keretezett (`renderUntrusted(…, "framed")`), a `structuredContent`-et puszta (`"plain"`) alakban rajzolja ki — ez az egyetlen pont, ahol a két csatorna eltér. Az 50 000 karakteres korlát fölött **mindkét csatornát** csonkolja (a `structuredContent` helyére `{ truncated, originalChars, note }` kerül); a `formatError` a hibatörzset redaktálja és 2 000 karakterre csonkolja. `formatDateTime(value, timeZone)` a Flex `YYYY-MM-DD HH:mm:ss` alakjára hoz — falióra-szemantikával, lásd „Kulcsdöntések"; a `formatDate(value, timeZone)` ugyanez **csak dátumra** (`YYYY-MM-DD`), a vágás a zóna-átszámítás **után** — ezt várja a `POST /dms/workflow/start` `deadline` mezője. A `formatError`-ban tartalék-ág van a nyers `maxContentLength`-hibára is (ha valami megkerülné a `client.download()` fordítását). **WF18-tól** a `resourceJson` ugyanezt a láncot adja a resource-ok `text` tartalmának — a `structuredContent` nélkül, mert a `resources/read`-nek nincs ilyen csatornája. |
| `projection.ts` | A két listázó eszköz lista-projekciója és lapozása: `summarizeTask` (`/dms/news` elem — **WF11-től** `idKind: "taskId" \| "wfTaskId"` is, a `type`-ból származtatva), `summarizeWfTask` (`/dms/wfTasks/my` elem), `paginate(items, offset, limit)` és `envelope(payload, options, summarize)`. A fejkomment mérésekkel írja le, **mi és miért** marad ki a summary-ből. |
| `schema.ts` | A szerver által épített válaszok `outputSchema`-i (`diagOutput`, `templateDetailsOutput`, `downloadOutput`, `taskListOutput`, `wfTaskListOutput`). A `looseOutput(shape)` helper minden mezőt opcionálissá tesz, hozzáadja a csonkolás-ág (`truncated`/`originalChars`/`note`) mezőit, és `.loose()`-ol (**WF20-tól**, Zod 4 — a `.passthrough()` ott deprecated, a jelentése ugyanaz). A fejkomment írja le, miért **laza** a séma és miért csak öt eszközön van. |
| `untrusted.ts` | A felhasználó által írt Flex-mezők jelölése (P2-4/B9, **WF17**): `htmlToText` (zéró függőségű HTML→szöveg: rejtett elemek ki, blokk→sortörés „max” szemantikával, entitás-dekódolás a tag-levágás **után**), `markUserContent`/`withUntrusted` (a `USER_AUTHORED_KEYS` mezők és a `Text`/`Textarea` típusú `metaItems` értékei marker-objektumra cserélve, `untrustedFields` útvonal-listával), `renderUntrusted` (a `toolJson` hívja: `framed` a `text`-re, `plain` a `structuredContent`-re), `escapeMarkers` (a keret belülről nem hamisítható), `closeOpenFrames` (csonkolt keret lezárása). A fejkomment írja le, miért marker-objektum és miért két csatorna. |
| `resources.ts` | MCP **Resources** (P2-2, **WF18**): `flex://templates` (sablonlista), `flex://template/{id}` (`ResourceTemplate`, a `{id}`-hez `complete` callback-kel), `flex://my-tasks` (a `/dms/news` `in-progress` listája a WF9 summary-projekciójával). Itt van a `createTemplateCache` is: a sablonlista 60 s-os gyorsítótára, amit a resource-ok és a promptok **megosztanak** (`list` + `complete`); a `complete` hiba esetén üres listát ad, nem dob. |
| `prompts.ts` | MCP **Prompts** (P2-3, **WF18**): `start-workflow` (a `templateId` argumentum `completable`, ugyanabból a gyorsítótárból), `daily-summary`, `complete-task`. Magyar, vezetett szövegek a `SERVER_INSTRUCTIONS` fogalmaival (Task ≠ WfTask), és minden visszavonhatatlan lépés (indítás, lezárás) előtt jóváhagyás-kérés. Az `optionalArgs` helper magyarázza, miért `.default({})` + visszatett `shape` a séma. |
| `debug.ts` | Opt-in nyomkövetés a **kimenő** kérés-törzsekről (`FLEX_DEBUG`, alap kikapcsolva): `isDebugEnabled()` és `debugRequestBody(label, body)`. A napló stderr-re megy (a stdout az MCP stdio-transzporté), a `files[].content` base64 blobja méret-jelzésre cserélve, és a törzs átmegy a `redactSecrets`-en. Szándékosan **env-kapcsoló, nem `FlexConfig`/`user_config` mező**: hibakeresési eszköz, nem végfelhasználói beállítás |
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
- **A kötelezőség-validáció explicit `required`/`mandatory` kulcsra fut, ennek hiányában
  `visibility: "MT_K"`-ra esik vissza** (`parseTemplateFields` → `requiredMarkerPresent` /
  `visibilityMarkerPresent`). A 66-os sablon mezőin nincs `required`/`mandatory` kulcs, csak
  `visibility: MT_K`/`MT_M` — a régi kód ezt `required: false`-ra fordította, így az ellenőrzés
  mindent átengedett, miközben a leírás azt ígérte, hogy ellenőriz. **P0-6 lezárva (2026-09-03):**
  élő UI-egyeztetés (a "Belső projekt jóváhagyás (v6)" sablon "Létrehozás" dialógusa, 6/6 mezőn)
  igazolta, hogy a Flex pontosan a `MT_K` mezőket jelöli kötelezőnek — ez nincs írott Flex-doksiban,
  ezért gyengébb forrás, mint egy explicit kulcs. A `describeTemplate` ezt a
  `validation: "api-flag" | "visibility-flag" | "none"` mezőben (és `"none"`/`"visibility-flag"`
  esetén egy `note`-ban) mondja ki, a `flex_workflow_start` pedig a `visibility-flag` ágon is
  előre jelez hiányzó mezőt, nem csak `api-flag`-nél.

- **A Flexnek küldött törzs kulcskészlete teljes, akkor is, ha üres.** A `flex_workflow_start`
  mindig küld `linkedItem`-et (`null`), `files`-t (`[]`), `description`-t (`""`) és `deadline`-t
  (`null`), a `flex_task_create` pedig `taskPerformers.organizationCodes`-ot is (`[]`). Miért nem
  „csak amit megadtak": a Flex ezeket a kulcsokat **olvassa**, és a hiányzótól PHP notice-szal
  HTTP **500**-at ad (`Undefined property: stdClass::$linkedItem`), nem 400-as validációs hibát —
  vagyis a kihagyott kulcs nem elhagyható opció, hanem hibás kérés. A referencia a felület saját
  payloadja (2026-09-04-i minták); ha új mellékhatásos eszköz kerül ide, a törzsét ugyanígy a
  felületi payloadhoz kell mérni, és a `FLEX_DEBUG` naplója pont ehhez van.
- **Az Option mezők kódját a `params` lista sorrendje adja, mert a Flex nem küldi.** A
  `startDetails` csak címkéket ad (`params: "|első;második"`), a `POST /dms/workflow/start`
  viszont kódot vár (`"2"`) — a kód a lista **1-alapú sorszáma**, felületi payloadokkal igazolva
  (2026-09-04). A `describeTemplate` ezért `{ code, label }` párokat ad, a `resolveOptionValues`
  pedig a kódot és a címkét is elfogadja. A **kód-ág elsőbbsége** szándékos: van sablon, ahol a
  címkék maguk is számok (66-os `beruh`), ott a `"4"` másképp is érthető lenne — így az
  értelmezés kiszámítható, a hibaüzenet pedig `kód = "címke"` párokat listáz. Ha a Flex egyszer
  kódot is ad a válaszban, az a származtatásnál erősebb forrás: arra kell váltani.
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
- **Minden `inputSchema` explicit `z.object({...})`, nem nyers shape** (WF20, SDK v2). A v2
  `registerTool` a nyers `{ field: z.string() }` alakot csak deprecated túlterhelésen fogadja, és
  a **saját, bundle-ölt** Zodjával csomagolja be — ez egy külön Zod-példánnyal futásidőben
  elszállhat. Az explicit `z.object()` a mi Zodunkkal fut, és a `.describe()`-ok a
  `~standard.jsonSchema` úton (Zod ≥ 4.2) sértetlenül érnek a `tools/list`-be. A kliens által
  látott séma a migráció előttivel ekvivalens (snapshot-diff, lásd [`../CLAUDE.md`](../CLAUDE.md)).
- **A `toolJson` méretkorlátja védőháló, nem az elsődleges eszköz.** Az elsődleges a kérés oldalán
  ható `limit`/`fields`; a csonkolás akkor lép be, ha valami mégis átcsúszna. Korábban csak a
  `text` csonkolódott, a `structuredContent` teljes egészében ment — ez a P1-4 hibája volt, mert a
  kliens azt is a modell elé teszi.
- **Váratlan válaszalak esetén a nyers payload megy tovább.** Ha a Flex `result`-ja nem tömb, az
  `envelope` `undefined`-et ad, és a hívó a nyers választ küldi el. Miért: egy alakváltozásnál
  rosszabb csendben elrejteni az adatot, mint kihagyni a lapozást.
- **A felhasználói szöveg keretezése a tool-ban dől el, a kirajzolása a `toolJson`-ban** (WF17,
  `untrusted.ts`). A tool tudja, melyik válasz hordoz felhasználói mezőt — `withUntrusted(payload)`
  a `toolJson` **előtt** —, a `format.ts` tudja, hol válik szét a két csatorna: a `text`-ben
  `<untrusted source="flex:útvonal">…</untrusted>` keret (a modellnek szól; a `SERVER_INSTRUCTIONS`
  mondja ki, hogy a keret tartalma adat, nem utasítás), a `structuredContent`-ben puszta szöveg +
  `untrustedFields` útvonal-lista (programnak szól). A marker **sima objektum**
  (`{ __untrusted: true, source, text }`), nem osztálypéldány: a `redactSecrets` kulcsonként másol,
  egy osztály elveszítené a típusát — így viszont a marker `text`-je redaktálva ér a kirajzoláshoz
  (egy megjegyzésbe másolt token is kiesik). A `renderUntrusted` szerkezet-megosztó: marker nélküli
  fán ugyanazt a hivatkozást adja, ezért a 13 nem érintett eszköz `structuredContent`-je változatlan.
  Miért zéró függőségű a HTML→szöveg: a bundle-be minden könyvtár egészben kerülne, és a cél az
  olvasható szöveg, nem a DOM. Ár: a summary-lista `subject` mezői a `text`-ben elemenként ~60
  karakterrel hosszabbak a keret miatt (20 elemre ~1,2 kB a 7,3 kB-ra).
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

- **A resource-ok csak-olvasók, és a tool-változatuk megmarad** (WF18). A `resources.ts` három
  URI-ja ugyanazt az adatot adja, mint a megfelelő eszköz — a különbség az, **ki kezdeményez**:
  a resource-t a felhasználó csatolja a kliens „+" menüjéből (a modellnek nem kell kitalálnia,
  melyik eszközt hívja), a toolt a modell hívja, amikor magától navigál. Mellékhatásos műveletnek
  (indítás, lezárás, letöltés) ezért nincs resource-változata. A `flex://my-tasks` a `/dms/news`
  vegyes listáját adja, nem a `/dms/wfTasks/my`-t: a „mi van nálam" kérdésre a **Task és a WfTask
  együtt** a válasz, és az elemek `idKind`-ja megmondja, melyik eszközcsalád viszi tovább.
- **A `templateId` completion értéke maga az id, nem „id — név"** (WF18). A `completion/complete`
  javaslatát a kliens **változatlanul** írja be az argumentumba, tehát egy díszített javaslat
  használhatatlan értéket adna. A szűrés viszont a névre és a kódra is illeszkedik, hogy a sablon
  nevének begépelésével is meg lehessen találni a számot. A lista 60 s-ig gyorsítótárazott, mert a
  completion **gépelés közben**, leütésenként érkezik; hiba esetén üres javaslat megy vissza, nem
  protokollhiba — a gépelést nem szabad hibaüzenettel megszakítani. A `resources/read` ezzel
  szemben mindig friss adatot kér: ott az elavult válasz valódi hiba lenne.
- **A promptok jóváhagyást kérnek a visszavonhatatlan lépés előtt — szöveggel, nem kóddal.**
  Kikényszeríteni nem tudjuk (a prompt csak üzenetet ad a modellnek), ezért a tesztek a prompt
  **szövegét** nézik: benne van-e a jóváhagyás-kérés és a helyes eszköz neve. A destruktív jelölés
  (`destructiveHint`) továbbra is a tool-on van, az a kliens megerősítő párbeszédének a forrása.
