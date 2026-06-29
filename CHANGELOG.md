# Changelog

A jelölés a [Keep a Changelog](https://keepachangelog.com/) és a
[SemVer](https://semver.org/) ajánlásait követi.

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
