# DMS One Flex MCP Server

Lokálisan futtatható **MCP (Model Context Protocol) szerver** a DMS One **Flex** REST API-hoz.
Ugyanazokat a végpontokat teszi elérhetővé, mint a [`n8n-nodes-dmsone-flex`](https://github.com/dmsreg/n8n-nodes-dmsone-flex)
közösségi node — de Claude Desktop (vagy bármely MCP-kompatibilis kliens) számára.

A szerver **stdio** transzporton fut: a Claude Desktop indítja el alfolyamatként.
Minden felhasználó a **saját tokenjével** futtatja lokálisan — nincs közös szerver.

---

## Mit tud (tool-ok)

**Feladat (Task)**
| Tool | Leírás |
|---|---|
| `flex_task_create` | Új DMS feladat létrehozása |
| `flex_task_comment` | Megjegyzés feladathoz |
| `flex_task_accept` | Feladat elfogadása |
| `flex_task_complete` | Feladat lezárása |
| `flex_task_list` | Feladatok listázása állapot szerint |

**Felhasználó (User)**
| Tool | Leírás |
|---|---|
| `flex_user_get_by_username` | Felhasználó keresése név alapján (userId/orgId-hoz) |

**Munkafolyamat (Workflow)**
| Tool | Leírás |
|---|---|
| `flex_workflow_list_templates` | Elindítható sablonok listája |
| `flex_workflow_get_template_details` | Sablon kötelező metaadat mezői |
| `flex_workflow_start` | Új munkafolyamat indítása (metaadat-validációval) |
| `flex_workflow_get_my_tasks` | Saját munkafolyamat-feladatok |
| `flex_workflow_get_task_details` | Feladat részletei + lehetséges eredmények |
| `flex_workflow_complete_task` | Feladat lezárása eredménnyel |
| `flex_workflow_get_task_comments` | Feladat megjegyzései |
| `flex_workflow_add_task_comment` | Megjegyzés feladathoz |
| `flex_workflow_get_task_attachments` | Feladat csatolmányai |
| `flex_workflow_get_task_related_attachments` | Kapcsolódó csatolmányok |
| `flex_workflow_download_attachment` | Csatolmány letöltése lemezre (GUID alapján) |
| `flex_search_linked_items` | Kapcsolt elem (irat) keresése azonosító alapján |

**Diagnosztika**
| Tool | Leírás |
|---|---|
| `flex_diag` | Kapcsolat- és hitelesítés-ellenőrzés (`/diag`) |

---

## Letöltés

A kész telepítőcsomagot (`dmsone-flex-<verzió>.mcpb`) a GitHub **Releases**
oldaláról töltsd le. Új kiadás a maintainerek által, verzió-tag pusholásával
készül automatikusan (lásd lent: *Kiadás készítése*).

## Telepítés

A `dmsone-flex-<verzió>.mcpb` egy **platformfüggetlen** telepítőcsomag: ugyanaz a
fájl telepíthető **Windowson, macOS-en és Linuxon** is. A Claude Desktop saját
beépített Node.js futtatókörnyezetet használ, így a végfelhasználónak **nem kell
külön Node.js-t telepítenie**.

Részletes, lépésről-lépésre útmutatók (token beszerzése, telepítés, használat,
hibaelhárítás):

- 🪟 **Windows:** [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md)
- 🍎 **macOS:** [INSTALL-MACOS.md](INSTALL-MACOS.md)

Röviden (mindkét platformon): Claude Desktop → **Settings → Extensions** → húzd be
a `.mcpb` fájlt → add meg a **Flex tokened** az űrlapon → **Enable**.

### Csomag (.mcpb) újraépítése — fejlesztőknek

```bash
cd "DMS MCP/Flex"
npm run bundle
```

A lépések: `tsc` fordítás → a `manifest.json` `version` és `tools` mezőinek
szinkronizálása a lefordított szerverből (`scripts/sync-manifest.mjs`) →
**egyfájlos bundle** esbuilddel (`scripts/bundle.mjs`) → csomagolás a hivatalos
`@anthropic-ai/mcpb` eszközzel.

A csomagban **nincs `node_modules`**: az esbuild a tényleg elért függőség-kódot
egyetlen `dist/index.js`-be fordítja. Ezért a `.mcpb` ~200 kB (korábban 3,7 MB),
és nem visz a felhasználó gépére tranzitív függőségeket. A bundle tiszta
JavaScript, natív bináris nélkül, tehát ugyanaz a fájl telepíthető Windowson,
macOS-en és Linuxon.

A `manifest.json` `tools` tömbjét **ne szerkeszd kézzel** — a következő szinkron
felülírja.

### Kiadás készítése (maintainereknek)

1. Frissítsd a `CHANGELOG.md`-t, és commitold.
2. Emeld a verziót — **egy** lépésben, egy helyen:
   ```bash
   npm version minor   # vagy patch / major
   ```
   Ez átírja a `package.json`-t, a `version` npm-hook a `manifest.json` verzióját
   is szinkronizálja és a commitba veszi, majd létrehozza a `v<verzió>` taget.
3. Pushold a commitot és a taget:
   ```bash
   git push && git push --tags
   ```
4. A `v*` tagre a `Release` GitHub Actions workflow lefut: fordít, előállítja a
   `.mcpb`-t, és csatolja egy új GitHub Release-hez.

> A verziót **ne** írd át kézzel a `manifest.json`-ban: az `npm version` hookja
> egy forrásból (`package.json`) állítja be, a kézi szerkesztés csak elsodródást
> okoz.

---

## Token beszerzése

- **Personal Access Token (PAT)** — egyéni felhasználóknak. A Flex felületen a
  neved menüjében hozható létre. A saját nevedben hajt végre minden műveletet.
  (A tokennek lejárati ideje van.)
- **Station Token** — gépi/szolgáltatás token (jellemzően admin hozza létre).
  Több felhasználó nevében is eljárhat; ekkor a `FLEX_IMPERSONATED_EMAIL`
  beállítja, kinek a nevében menjenek a hívások.

---

## Claude Desktop konfiguráció (manuális mód)

A `.mcpb` telepítésnél a konfigurációt az űrlapon adod meg — nincs szükség kézi
fájlszerkesztésre. A **manuális (Node.js) mód** lépéseit és a pontos
`claude_desktop_config.json` útvonalat/JSON-t platformonként lásd:

- 🪟 [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md) → „B) Manuális telepítés"
- 🍎 [INSTALL-MACOS.md](INSTALL-MACOS.md) → „B) Manuális telepítés"

---

## Konfiguráció (környezeti változók)

| Változó | Kötelező | Alapértelmezett | Leírás |
|---|---|---|---|
| `FLEX_TOKEN` | ✅ | – | PAT vagy Station Token |
| `FLEX_BASE_URL` | – | `https://flex.dmsone.hu/api` | A Flex API alap URL-je |
| `FLEX_AUTH_METHOD` | – | `pat` | `pat` vagy `station` |
| `FLEX_IMPERSONATED_EMAIL` | – | – | Csak station tokennél: kinek a nevében járjon el |
| `FLEX_IGNORE_SSL` | – | `false` | SSL hibák figyelmen kívül hagyása (csak fejlesztéshez). A publikus `flex.dmsone.hu` URL-en nem engedett — a szerver ott hibával kilép induláskor |
| `FLEX_DOWNLOAD_DIR` | – | `<OS temp>/dmsone-flex` | Letöltött csatolmányok célkönyvtára (abszolút út). A letöltés **csak** ide vagy alkönyvtárába írhat; meglévő fájlt nem ír felül |
| `FLEX_TIMEZONE` | – | `Europe/Budapest` | IANA zónanév. A Flex helyi faliórát tárol, ezért a szerver ebben a zónában értelmezi az offsettel megadott dátumokat |
| `FLEX_MAX_DOWNLOAD_MB` | – | `50` | A csatolmány-letöltés felső határa MB-ban. A válasz teljes egészében memóriába kerül, ezért ez a korlát védi a szerverfolyamatot; a határ fölött a letöltés **hibát ad, nem csonkol** |
| `FLEX_CHECK_ON_START` | – | `false` | Induláskor egy `GET /diag` hívás a token ellenőrzésére; lejárt/érvénytelen tokenre stderr-figyelmeztetést ad, de a szerver ekkor sem lép ki |

---

## Fejlesztés

```bash
npm run dev      # tsx watch módban (FLEX_TOKEN env szükséges)
npm run build    # TypeScript fordítás dist/-be
```

Gyors kézi teszt az MCP Inspectorral:

```bash
FLEX_TOKEN=xxx npx @modelcontextprotocol/inspector node dist/index.js
```

---

## Custom mezők és folyamat-indítás (felfedezés-vezérelt minta)

Minden sablonnak más a kitöltendő mezőkészlete, és minden feladatnak más az
eredménykészlete. Ezt nem fix űrlap kezeli, hanem az asszisztens **futásidőben
lekérdezi a sémát**, kitölti, majd beküldi.

**Munkafolyamat indítása leírással + custom mezőkkel:**
1. `flex_workflow_list_templates` → válassz sablont (`id`).
2. `flex_workflow_get_template_details` → visszaadja a normalizált `fields`
   listát: `code`, `type`, `required`, `options` (Option mezőknél), `default`,
   valamint hogy kell-e kapcsolt elem (`linkedItemRequired`).
3. `flex_user_get_by_username` → `responsibleUserId`/`orgId`.
4. Ha kell kapcsolt elem: `flex_search_linked_items` → `linkedItemId`.
5. `flex_workflow_start` → `title`, `description`, és a `metadata` objektum a
   sablon `code` kulcsaival. A szerver ellenőrzi a kötelező mezőket, és hiány
   esetén megmondja a mező típusát és lehetséges értékeit.

**Munkafolyamat-feladat elvégzése:**
1. `flex_workflow_get_my_tasks` → válaszd ki a `wfTaskId`-t.
2. `flex_workflow_get_task_details` → a `possibleWfTaskResults` adja a választható
   eredménykódokat, a `metadata` pedig a lezáráskor frissíthető mezőket.
3. `flex_workflow_complete_task` → `wfTaskResult` + opcionális `comment` és `metadata`.

---

## Megjegyzés

Ez a lokális, REST-alapú változat **„egyelőre bármely usernek lokálisan futtatható”**
megoldás. A nagyobb, központi (K2 SOAP, HTTP/SSE, kulcskezelés) architektúrát a
projekt `dmsone-mcp-architecture-v1.1.md` dokumentuma írja le — az egy külön,
on-premise telepítésű irány.
