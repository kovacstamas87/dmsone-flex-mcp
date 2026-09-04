# src/tools — a 19 MCP eszköz regisztrációja

Erőforrásonként egy fájl. Mindegyik egyetlen `register*Tools(server, client, config?)` függvényt
exportál, amit az [`../index.ts`](../index.ts) hív. Egy eszköz = egy `server.registerTool(name,
{ title, description, inputSchema, outputSchema?, annotations }, handler)` hívás; a `McpServer`
**WF20-tól** a `@modelcontextprotocol/server` csomagból jön (SDK v2), az `inputSchema` pedig mindig
explicit `z.object({...})` — miért, lásd [`../CLAUDE.md`](../CLAUDE.md) „Kulcsdöntések".

**A `client` paraméter típusa `FlexHttp`, nem `FlexClient`** (WF12, [`../client.ts`](../client.ts)):
a tool-fájlok csak a `request`/`download` metódust hívják, sosem az axios-specifikumokat. Éles
kódban ez ugyanúgy a `FlexClient` példány (`index.ts` építi), de a teszt ([`../../test/handlers.test.ts`](../../test/handlers.test.ts))
egy egyszerű fake-et ad át helyette.

## Fájl-leltár

| Fájl | Erőforrás | Eszközök | Megjegyzés |
|---|---|---|---|
| `task.ts` | **Task** — kézzel kiosztott DMS feladat, `taskId` | `flex_task_create`, `_comment`, `_accept`, `_complete`, `_list` | `/dms/task`, `/dms/news`. **WF4-től a `config`-ot is megkapja**: a `taskDeadline` / `taskScheduledStart` a `config.timeZone` faliórája szerint megy be. **WF9-től** a `_list` lapoz és összefoglalót ad (`../projection.ts`), a leírása pedig kimondja a `/dms/news` két ismert Flex-hibáját — lásd lent |
| `workflow.ts` | **WfTask** — egy futó munkafolyamat egy lépése, `wfTaskId` | 12 eszköz: sablonok, indítás, feladatok, megjegyzések, csatolmányok, `flex_search_linked_items` | a legnagyobb fájl; a sablon-feldolgozás (`parseTemplateFields` → `describeTemplate` / `missingRequiredMessage`) itt exportált, hogy tesztelhető legyen. A letöltés a [`../paths.ts`](../paths.ts)-re épül, a `downloadBaseDir(config)` adja a sandbox gyökerét |
| `user.ts` | Felhasználó | `flex_user_get_by_username` | Csak `userId` + `userName` — **`orgId`-t nem ad**, pedig a Flexben a kettő együtt azonosít (lásd „Kulcsdöntések") |
| `diagnostic.ts` | Diagnosztika | `flex_diag` | kapcsolat- és token-ellenőrzés; a `pickDiagFields()` a `/diag` válaszából csak `ok`/`method`/`uri`/`qs`-t engedi tovább. **WF19-től** itt van a `checkTokenOnStart(client)` is: nem tool, hanem az `index.ts` induláskor hívja opt-in módon (`FLEX_CHECK_ON_START`) — egy `GET /diag`, hibára stderr-figyelmeztetés a `formatError` szövegével, sosem dob |

**`outputSchema` (WF10-től) öt eszközön van:** `flex_diag`, `flex_task_list`,
`flex_workflow_get_my_tasks`, `flex_workflow_get_template_details`,
`flex_workflow_download_attachment` — a sémák a [`../schema.ts`](../schema.ts)-ben, a szabály lent.

**Ne keverd:** Task ≠ WfTask — a Flex API-ban is külön végpont-család, és a `SERVER_INSTRUCTIONS`
(`../index.ts`) ezt explicit módon a modell tudtára adja. Ha egy új eszköz kerül ide, döntsd el
először, melyik fogalomhoz tartozik.

**Egy kivétel a szétválasztás alól:** a `/dms/news` (`flex_task_list`) **vegyes** listát ad —
`Task` és `WfTask` elemeket egyaránt, a `type` mező különíti el őket (a mintában 1 Task és 20
WfTask). A leírás ezt kimondja, mert enélkül a modell Task-ként próbálna lezárni egy WfTask-ot.
A `taskId` és a `wfTaskId` **továbbra sem cserélhető fel**: a `/dms/news` mindkét fajtát `id`
kulcson adja vissza, a WfTask-műveletekhez viszont a `flex_workflow_get_my_tasks` `wfTaskId`-ja
kell. **WF11-től** a `flex_task_list` minden elemén ott az `idKind` (`"taskId"` / `"wfTaskId"`) is,
hogy a modellnek ne kelljen a `type` stringet eszköznévre fordítania.

## Rögzített szabályok

- **Soha ne állíts össze tool-eredményt kézzel.** Minden handler `toolJson(...)` / `toolError(...)`
  párral tér vissza ([`../format.ts`](../format.ts)). Miért: ez a titok-redakció **egyetlen**
  beépítési pontja — egy kézzel írt `content: [...]` / `structuredContent` / `isError` kiesne a
  szűrőből. A `test/format.test.ts` „megkerülés-őr" tesztje forrás-szinten tiltja; a `content:`
  minta szándékosan `content:\s*\[`, mert a `workflow.ts` csatolmány-**kérésében** van egy jogos
  `content:` mező (az bemenet, nem eredmény).
- **A handler mindig `try`/`catch`-el**, a `catch` `toolError(error)`-t ad — a `formatError`
  fordítja HTTP-státuszból magyar, cselekvésre bíró üzenetté.
- **A leírás (`description`) csak azt ígérje, amit a kód tesz.** Ez nem stílus, hanem
  kész-kritérium: a `test/tools-list.test.ts` a **valódi `tools/list`** választ ellenőrzi, mert a
  leírás ott őszinte vagy hamis, ahol a modell olvassa. Ma három ilyen őr fut: a letöltés nem ígér
  tetszőleges útvonalat (WF3), a sablon-részletek nem ígérnek feltétel nélküli kötelezőség-
  ellenőrzést, és a dátumot fogadó eszközök megnevezik a falióra-szemantikát és a `FLEX_TIMEZONE`-t
  (WF4). WF9-ben három továbbival: a listázók leírása kimondja a lapozást és az összefoglaló
  alapértelmezést (a séma `limit`/`offset`/`fields` mezőjével együtt), a feladatlista megnevezi,
  mi marad ki és hogy a lista vegyes, a sablon-részletek pedig az `includeRaw` alapértelmezését.
  **WF10-től az `includeRaw`-őr a paraméter `.describe()`-jét nézi**, nem a tool-leírást — mert az
  ígéret oda került. Ha egy ígéret helyet változtat, az őr költözzön vele; a rossz helyen álló őr
  zöld marad, miközben az ígéret eltűnt.
- **A leírás-őszinteség a *szerveroldali* hibákra is vonatkozik.** A `flex_task_list` leírása
  kimondja, hogy a `status: "all"` ma HTTP 500-ba fut (a Flex elhasal a hiányzó `status`
  paraméteren), és hogy a `pending` és a `completed` ugyanazt a listát adja vissza. Miért van ez a
  leírásban, ha nem a mi hibánk: a modell ebből választ szűrőértéket — ha elhallgatjuk, hibás
  hívást fog megkísérelni, és a Flex hibaüzenetéből próbál majd következtetni. Az opciót viszont
  **nem vettük ki**: a hívás helyes, és ha a Flex javítja, magától működni fog; a kivétele
  visszafelé törő változás lenne. A bejelentés a [`../../../flex-diag-hibajelentes.md`](../../../flex-diag-hibajelentes.md)
  2. és 3. pontja. Ha a Flex javítja, ez a két mondat kikerül a leírásból.
- **Az annotációk a valós hatást írják le**, nem a szándékot: ami a Flexbe vagy a lemezre ír, az
  nem `readOnlyHint`; ami visszavonhatatlan (`complete_task`, `task_complete`, `workflow_start`),
  az `destructiveHint: true`. A `tools-list.test.ts` a következetességet is fogja (read-only →
  nem destruktív, idempotens).
- **A listázó eszközök nem adnak vissza nyers listát.** A `flex_task_list` és a
  `flex_workflow_get_my_tasks` a [`../projection.ts`](../projection.ts) `envelope()`-jén megy át:
  `limit` (1–100, alap **20**), `offset` (alap 0), `fields` (`summary` | `full`, alap **summary**),
  boríték `{ total, offset, returned, hasMore, fields, items }`. Ha új listázó eszköz kerül ide,
  ugyanezt a szerződést kövesse — a modell így egy szótárt tanul meg, nem eszközönként újat.
  A `summarize*` függvények **engedélyező listák**: egy később hozzáadott Flex-mező magától nem
  kerül a summary-be, dönteni kell róla.
- **A részletet a részletező eszköz adja, nem a lista.** Ha egy mező a listában drága (HTML,
  metaadat-tömb, beágyazott gyűjtemény), a helye a `get_task_details` / `_comments` /
  `_attachments`, a listában legfeljebb egy darabszám. Ugyanez az elv vitte el a `raw`-ot a
  `flex_workflow_get_template_details` alapértelmezéséből (`includeRaw: false`): a `fields` már a
  `raw` normalizált kivonata, a kettő együtt duplázna.
- **Felhasználói szöveget hordozó válasz `withUntrusted()`-en át megy a `toolJson` elé** (WF17,
  [`../untrusted.ts`](../untrusted.ts)). Ma hat eszközön: `flex_task_list`, `flex_task_comment`,
  `flex_workflow_get_my_tasks`, `_get_task_details`, `_get_task_comments`, `_add_task_comment`.
  Miért ezek: a Flex itt ad vissza leírást, tárgyat vagy megjegyzést — más felhasználók gépelt
  szövegét, ami a modellnek utasításnak látszhat. Ha új eszköz olyan végpontot fed, ami ilyen mezőt
  ad, ugyanígy. A jelölés kulcs alapú **engedélyező lista** (`USER_AUTHORED_KEYS`): egy új
  felhasználói mező oda kerül, nem ide. A `flex_workflow_get_task_details` és a
  `_get_task_comments` leírása megnevezi a keretet — őr a `tools-list.test.ts`-ben.
- **A dátumokat a `formatDateTime(value, config.timeZone)` írja át**, sose kézzel. A Flex
  falióra-időt tárol; a részleteket és a „miért"-et lásd [`../CLAUDE.md`](../CLAUDE.md). A
  `flex_workflow_start` `deadline`-ja a `formatDate`-en megy át (`YYYY-MM-DD`), mert a felület is
  dátumot küld — ha egy mezőnél kiderül, hogy a felület más alakot használ, a felületi payload
  dönt, nem a mi kényelmünk.
- **A mellékhatásos eszközök törzse a felületi payload kulcskészletét viszi, üres értékkel is**
  (`linkedItem: null`, `files: []`, `description: ""`, `deadline: null`, `organizationCodes: []`).
  A hiányzó kulcstól a Flex 500-at ad, nem 400-at — a „csak amit megadtak" törzs tehát hibás kérés.
  Az őr a `test/handlers.test.ts` „a kimenő törzs" blokkja, ami a **kulcsokat** nézi, nem csak az
  értékeket. Félkész objektumot sem küldünk: fél kapcsolt elemre (`linkedItemType` `linkedItemId`
  nélkül vagy fordítva) a tool validációs hibát ad.
- **Option mezőnél a tool kódra fordít, és ismeretlen értéket nem továbbít.** A Flex a kódot
  várja, a modell a címkét látja — `resolveOptionValues` mindkettőt elfogadja (előbb kód, aztán
  címke), ismeretlen értéknél pedig hibát ad az érvényes `kód = "címke"` párokkal, hogy a modell
  ne a Flex 500-ából próbáljon következtetni. Lásd [`../CLAUDE.md`](../CLAUDE.md) „Kulcsdöntések".
- **Az `orgId` mezőknek nincs néma alapértelmezésük** (WF11). A `flex_task_create`
  `performerOrgId`-ja és a `flex_workflow_start` `responsibleOrgId`-ja korábban csendben `1`-re
  esett vissza, ha nem adták meg — ez rossz szervezeti egységhez rendelt feladatot okozhatott
  észrevétlenül. Most mindkettő kötelező (a `performerOrgId` a `performerUserId` megadásához
  kötve, futásidőben ellenőrizve).
- **A `/dms/ac/user` NEM ad `orgId`-t — a leírások ezt WF14-ig hamisan ígérték.** A WF11
  `.describe()`-jei „a `flex_user_get_by_username` válaszának `orgId` mezőjéből" szöveggel olyan
  végponthoz küldték a modellt, ami a kért értéket nem tudja megadni; élő, read-only mintavétel
  (flex-dev, 2026-09-03) mutatta meg, hogy a válasz csak `userId`-t és `userName`-et tartalmaz.
  Javítva: a valódi forrás a `flex_task_list` elemeinek `orgId` mezője vagy egy wfTask
  `wfDetails.responsibleUser.orgId`-ja, **egyszer** kimondva a `user.ts` leírásában; a két
  paraméter csak odamutat, mert a WF10 leírás-költségvetése valós teher. Ugyanitt derült ki, hogy
  a keresés a **megjelenített névre** illeszkedik és **ékezet-érzékeny** (`"ková"` talál,
  `"kovacs"` nem) — ez is bekerült a leírásba, mert enélkül egy üres találat úgy néz ki, mintha a
  felhasználó nem létezne. Az őr: `test/tools-list.test.ts`.
- **Kötelező mező: best effort, kimondva, két forrással.** A `workflow.ts` előre szól hiányzó
  mezőről, ha a sablon `required`/`mandatory` kulcsot hordoz (`requiredMarkerPresent`, `"api-flag"`),
  ennek hiányában a `visibility: "MT_K"`-ra esik vissza (`visibilityMarkerPresent`,
  `"visibility-flag"`) — **P0-6 lezárva** (2026-09-03, élő UI-egyeztetés). Sem jelölés, sem
  visibility esetén (`"none"`) az érdemi ellenőrzés a Flex szerveré. A `validation` mező ezt a
  modellnek is megmondja, lásd [`../CLAUDE.md`](../CLAUDE.md) „Kulcsdöntések".


- **A leírásnak költségvetése van: az összleírás < 4 700 karakter** (`tools-list.test.ts`).
  A `tools/list` minden munkamenet elején bekerül a modell kontextusába, tehát a leírások hossza
  állandó, fizetett teher — a WF10 előtt 11 936 karakter volt, a WF10 után 4 365, ma 4 619
  (a keret 4 500-ról 4 700-ra a WF17-ben nőtt: a két, felhasználói szöveget adó eszköz leírása
  megnevezi az `<untrusted>` keretet, és ez őszinteség-mondat, nem díszítés). A hármas munkamegosztás:
  **paraméter-magyarázat** → a Zod `.describe()`-ba (a modell ugyanúgy látja, a `tools/list`
  `inputSchema`-jában), **a válasz alakja** → `outputSchema`, **a leírásban** csak „mi ez",
  „mikor használd" és egy mondat a visszatérésről marad. Ami *nem* kerülhet ki: az őszinteség-
  mondatok (sandbox, best-effort, falióra, ismert Flex-hibák) — azok nem díszítés, hanem a
  kész-kritérium.
- **`outputSchema` csak akkor, ha a választ mi építjük — és akkor is lazán.** A szabály:
  `z.object({...}).partial().loose()` (Zod 4; korábban `.passthrough()`) a [`../schema.ts`](../schema.ts) `looseOutput()`-ján
  keresztül, a csonkolás-ág mezőivel együtt. Miért nem szigorúbb: az SDK a `structuredContent`-et
  **validálja**, és bukásra a hívás `InvalidParams`-szal elszáll — egy túl szigorú séma tehát nem
  hibát *jelez*, hanem hibát *okoz* élesben. Három valós ág ad a tool saját alakjától eltérő
  választ: a `toolJson` méretkorlátja (`{ truncated, originalChars, note }`), a listázók
  fallbackje nem-tömb `result` esetén, és a Flex maga. A Flex nyers válaszát továbbadó
  (passthrough) eszközökön ezért **nincs** séma: az ő alakjukra nincs szerződésünk. A
  `test/schema.test.ts` fixture-alakú válaszokon őrzi, hogy a séma ne bukjon.
- **A `flex_user_get_by_username` szándékosan séma nélküli.** A WF10 terve felajánlotta a
  normalizálást (`{ userId, orgId, username, displayName }`), de a végpont **listát** ad — a
  részleges egyezés több találatot is hozhat —, egyetlen objektumra normalizálva pedig találatok
  esnének ki. Élő minta nélkül a mezőnevek átkeresztelése (`userName` → `username`) is találgatás
  lenne, ezért a tool passthrough maradt: a `userId` a nyers válaszból is közvetlenül olvasható.
  (A WF14 élő mintája megerősítette: a válasz `orgId`-t nem is tartalmaz.)

## Kapcsolódó

- [`../CLAUDE.md`](../CLAUDE.md) — a `src/` fájl-leltára és a kulcsdöntések (dátum, redakció, sandbox)
- [`../../test/CLAUDE.md`](../../test/CLAUDE.md) — mit fed le melyik teszt
