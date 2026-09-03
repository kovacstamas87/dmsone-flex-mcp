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
| `sync-manifest.test.ts` | A `scripts/sync-manifest.mjs` idempotens, és a `manifest.json` verziója a `package.json`-t követi | WF1 |
| `redact.test.ts` | `src/redact.ts`: kulcs- és érték-alapú szűrés, a valós Flex-mezők érintetlensége, másolat-szemantika, ciklusvédelem, a bejelentett literális titok | WF2 |
| `format.test.ts` | `src/format.ts`: a `toolJson` a `text`-et és a `structuredContent`-et is redaktálja; a hibatörzs 2 000 karakterre csonkol; a hibaüzenetek szövege változatlan. Plusz a **megkerülés-őr** (lásd lent) | WF2 |
| `diag.test.ts` | `src/tools/diagnostic.ts` `pickDiagFields()`: a `/diag` válaszából csak `ok`/`method`/`uri`/`qs` marad, mindkét válaszalakra | WF2 |
| `paths.test.ts` | `src/paths.ts`: `sanitizeFileName` (traversal, `.`/`..`, fenntartott nevek, tiltott karakterek, 200 kódpont, idempotencia), `resolveDownloadPath` (engedett/tiltott `savePath`-ok posix **és** win32 alakban, `a/b/../c` engedett), `ensureDirInside` (symlink-kiszökés elutasítva, macOS `/var` symlinkes temp átmegy) és `uniquePath` valódi temp-könyvtárban, plusz a teljes lánc (`resolve → ensureDir → unique → wx`) | WF3 |
| `tools-list.test.ts` | A szervert **valódi stdio-transzporton** indítja (`node --import tsx src/index.ts`, dummy token), és a `tools/list` választ nézi: 19 eszköz, a négy WF3-annotáció, a read-only eszközök következetessége, a letöltés leírása nem ígér tetszőleges útvonalat; **WF4-ben**: a sablon-részletek leírásából eltűnt a „MINDIG", az indítás leírása kimondja a best-effortot, a dátumos eszközök megnevezik a falióra-szemantikát és a `FLEX_TIMEZONE`-t | WF3, WF4 |
| `datetime.test.ts` | `src/format.ts` `formatDateTime` és a `FLEX_TIMEZONE` konfigurációja: offsetes bemenet átszámítása CET/CEST-re, offset nélküli falióra változatlansága, csak-dátum, éjfél `00`-ként, a mintára illő de nem létező időpontok elutasítása, zóna-visszaesés elírt `FLEX_TIMEZONE`-nál | WF4 |
| `template.test.ts` | `src/tools/workflow.ts` sablon-feldolgozása: `parseTemplateFields` `requiredMarkerPresent`-je (`required`/`mandatory`, a kulcs jelenléte vs. értéke), `describeTemplate` `validation` + `note` mezője, `missingRequiredMessage` best-effort viselkedése | WF4 |
| `config.test.ts` | `src/config.ts` `validateConfig`: üres token, SSL-kikapcsolás publikus vs. fejlesztői URL-en, PAT+impersonáció, több hiba/figyelmeztetés egyszerre, érvénytelen `baseUrl` | WF5 |

## Rögzített szabályok

- **Valós titok nem kerülhet tesztfájlba.** A redakciós tesztek *kitalált* tokennel és
  `APP_KEY`-jel dolgoznak; a fixture-ökben a **szerkezet** a lényeg (a `/diag` `req` / `cookies` /
  `server` burkolói), nem a konkrét érték.
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
