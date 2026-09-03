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
| `tools-list.test.ts` | A szervert **valódi stdio-transzporton** indítja (`node --import tsx src/index.ts`, dummy token), és a `tools/list` választ nézi: 19 eszköz, a négy WF3-annotáció, a read-only eszközök következetessége, a letöltés leírása nem ígér tetszőleges útvonalat; **WF4-ben**: a sablon-részletek leírásából eltűnt a „MINDIG", az indítás leírása kimondja a best-effortot, a dátumos eszközök megnevezik a falióra-szemantikát és a `FLEX_TIMEZONE`-t; **WF9-ben**: a két listázó leírása kimondja a lapozást és az összefoglaló alapértelmezést, a séma tartalmazza a `limit`/`offset`/`fields` mezőt (`limit` alapértelmezése 20), a feladatlista megmondja, mi marad ki és hogy a lista vegyes, a sablon-részleteknél az `includeRaw` alapból hamis; **WF10-ben**: az összleírás < 4 500 karakter, az `outputSchema` pontosan az öt szerver-épített válaszon van (és máshol nem), és minden séma laza (`additionalProperties: true`, `required` nélkül) — az `includeRaw`-őr pedig a paraméter `.describe()`-jét nézi, mert oda került az ígéret | WF3, WF4, WF9, WF10 |
| `datetime.test.ts` | `src/format.ts` `formatDateTime` és a `FLEX_TIMEZONE` konfigurációja: offsetes bemenet átszámítása CET/CEST-re, offset nélküli falióra változatlansága, csak-dátum, éjfél `00`-ként, a mintára illő de nem létező időpontok elutasítása, zóna-visszaesés elírt `FLEX_TIMEZONE`-nál | WF4 |
| `template.test.ts` | `src/tools/workflow.ts` sablon-feldolgozása: `parseTemplateFields` `requiredMarkerPresent`-je (`required`/`mandatory`, a kulcs jelenléte vs. értéke), `describeTemplate` `validation` + `note` mezője, `missingRequiredMessage` best-effort viselkedése; **WF9-ben**: a `raw` alapból kimarad, `includeRaw`-val jön vissza | WF4, WF9 |
| `config.test.ts` | `src/config.ts` `validateConfig`: üres token, SSL-kikapcsolás publikus vs. fejlesztői URL-en, PAT+impersonáció, több hiba/figyelmeztetés egyszerre, érvénytelen `baseUrl` | WF5 |
| `projection.test.ts` | `src/projection.ts`: a summary kulcskészlete és az, hogy HTML / `metaItems` / kommentek / csatolmányok **nincsenek** benne; a vegyes Task+WfTask lista; a `templateName` lapítása; `paginate` szélei (túlfutó és negatív `offset`, üres lista, `hasMore`); az `envelope` mezői, a `full` mód és a nem-tömb `result` átengedése. A **21 elemes fixture summary-ja < 8 KB** kész-kritérium is itt van lefogva | WF9 |
| `schema.test.ts` | `src/schema.ts` öt `outputSchema`-ja **valós alakú** válaszokon: a szűrt `/diag`, a sablon-részletek `none` és `includeRaw` ága, a letöltés nyugtája (`contentType` nélkül is), a két listázó boríték `summary` és `full` módban, a nem-tömb `result` fallbackje, és a `toolJson` csonkolás-ága mindegyik sémán. A kérdés nem az, hogy a séma szigorú-e, hanem hogy **soha ne bukjon** — mert az SDK-validáció bukása élesben elszállasztja a hívást | WF10 |
| `fixtures/task-list.json` | A `/dms/news` élő, read-only mintája (21 elem), **anonimizálva** | WF9 |
| `fixtures/wf-tasks.json` | A `/dms/wfTasks/my` alakja (25 elem) a lapozás széleihez | WF9 |

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
  jogos `content:` mező, az bemenet, nem eredmény.
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
- **Nincs Flex-hívás a tesztekben.** A tesztek tiszta függvényeket fednek le; élő ellenőrzés a
  kiadási munkafolyamatban (WF7) történik, Inspectorral vagy újratelepített `.mcpb`-vel.
  A `tools-list.test.ts` ugyan elindítja a szervert, de a `tools/list` nem hív Flexet — ezért
  elég a dummy token, és hálózat nélkül is fut.
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
