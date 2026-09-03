# src/tools — a 19 MCP eszköz regisztrációja

Erőforrásonként egy fájl. Mindegyik egyetlen `register*Tools(server, client, config?)` függvényt
exportál, amit az [`../index.ts`](../index.ts) hív. Egy eszköz = egy `server.registerTool(name,
{ title, description, inputSchema, annotations }, handler)` hívás.

## Fájl-leltár

| Fájl | Erőforrás | Eszközök | Megjegyzés |
|---|---|---|---|
| `task.ts` | **Task** — kézzel kiosztott DMS feladat, `taskId` | `flex_task_create`, `_comment`, `_accept`, `_complete`, `_list` | `/dms/task`, `/dms/news`. **WF4-től a `config`-ot is megkapja**: a `taskDeadline` / `taskScheduledStart` a `config.timeZone` faliórája szerint megy be. **WF9-től** a `_list` lapoz és összefoglalót ad (`../projection.ts`), a leírása pedig kimondja a `/dms/news` két ismert Flex-hibáját — lásd lent |
| `workflow.ts` | **WfTask** — egy futó munkafolyamat egy lépése, `wfTaskId` | 12 eszköz: sablonok, indítás, feladatok, megjegyzések, csatolmányok, `flex_search_linked_items` | a legnagyobb fájl; a sablon-feldolgozás (`parseTemplateFields` → `describeTemplate` / `missingRequiredMessage`) itt exportált, hogy tesztelhető legyen. A letöltés a [`../paths.ts`](../paths.ts)-re épül, a `downloadBaseDir(config)` adja a sandbox gyökerét |
| `user.ts` | Felhasználó | `flex_user_get_by_username` | `userId` + `orgId` párt ad vissza — a Flexben **együtt** azonosít egy felhasználót |
| `diagnostic.ts` | Diagnosztika | `flex_diag` | kapcsolat- és token-ellenőrzés; a `pickDiagFields()` a `/diag` válaszából csak `ok`/`method`/`uri`/`qs`-t engedi tovább |

**Ne keverd:** Task ≠ WfTask — a Flex API-ban is külön végpont-család, és a `SERVER_INSTRUCTIONS`
(`../index.ts`) ezt explicit módon a modell tudtára adja. Ha egy új eszköz kerül ide, döntsd el
először, melyik fogalomhoz tartozik.

**Egy kivétel a szétválasztás alól:** a `/dms/news` (`flex_task_list`) **vegyes** listát ad —
`Task` és `WfTask` elemeket egyaránt, a `type` mező különíti el őket (a mintában 1 Task és 20
WfTask). A leírás ezt kimondja, mert enélkül a modell Task-ként próbálna lezárni egy WfTask-ot.
A `taskId` és a `wfTaskId` **továbbra sem cserélhető fel**: a `/dms/news` mindkét fajtát `id`
kulcson adja vissza, a WfTask-műveletekhez viszont a `flex_workflow_get_my_tasks` `wfTaskId`-ja
kell.

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
- **A dátumokat a `formatDateTime(value, config.timeZone)` írja át**, sose kézzel. A Flex
  falióra-időt tárol; a részleteket és a „miért"-et lásd [`../CLAUDE.md`](../CLAUDE.md).
- **Kötelező mező: best effort, kimondva.** A `workflow.ts` csak akkor szól előre hiányzó mezőről,
  ha a sablon egyáltalán hordoz `required`/`mandatory` jelölést (`requiredMarkerPresent`); az
  érdemi ellenőrzés a Flex szerveré. A `validation: "api-flag" | "none"` mező ezt a modellnek is
  megmondja. Miért: a 66-os sablon mezőin nincs jelölés, csak `visibility: MT_K`/`MT_M`, és a régi
  kód ezt `required: false`-ra fordítva „ellenőrzött"-nek látszott, miközben mindent átengedett.

## Kapcsolódó

- [`../CLAUDE.md`](../CLAUDE.md) — a `src/` fájl-leltára és a kulcsdöntések (dátum, redakció, sandbox)
- [`../../test/CLAUDE.md`](../../test/CLAUDE.md) — mit fed le melyik teszt
