# Changelog

A jelölés a [Keep a Changelog](https://keepachangelog.com/) és a
[SemVer](https://semver.org/) ajánlásait követi.

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
