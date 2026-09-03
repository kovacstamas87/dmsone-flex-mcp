# DMS One Flex MCP – Telepítés macOS-en

Lépésről lépésre útmutató a DMS One Flex bővítmény telepítéséhez **macOS** alatt,
Claude Desktopban. Két út van: **A) egykattintásos (.mcpb) – ajánlott**, és
**B) manuális (Node.js) – fejlesztőknek**.

> A `.mcpb` csomag platformfüggetlen: ugyanez a fájl megy Windowson és Linuxon is.
> A Claude Desktop saját beépített Node.js futtatókörnyezetet használ, ezért az
> **A) úthoz nem kell külön Node.js-t telepíteni.**

---

## Előfeltétel: Flex token beszerzése

A bővítmény a saját Flex hozzáféréseddel dolgozik, ehhez egy token kell.

- **Personal Access Token (PAT)** – egyéni használatra:
  1. Jelentkezz be a Flex felületére (pl. `https://flex.dmsone.hu`).
  2. Kattints a **nevedre** a jobb felső sarokban → a menüből hozz létre egy
     **Personal Access Tokent**.
  3. Másold ki a tokent (egyszer látható!) – ezt fogod beírni a telepítésnél.
- **Station Token** – gépi/szolgáltatás token, amit jellemzően az adminisztrátor ad.
  Ekkor megadhatod, hogy kinek a nevében járjon el (impersonáció).

---

## A) Egykattintásos telepítés (.mcpb) — AJÁNLOTT

### 1. lépés – A telepítőfájl beszerzése
Töltsd le a legfrissebb `dmsone-flex-<verzió>.mcpb` fájlt a **Releases** oldalról:
https://github.com/kovacstamas87/dmsone-flex-mcp/releases/latest
(a *Assets* alatt van), és mentsd egy könnyen elérhető helyre, pl. `Letöltések`
(Downloads). Ha nem érsz hozzá, kérd el a csapattól.

### 2. lépés – Claude Desktop megnyitása
Indítsd el a **Claude Desktop** alkalmazást. Ha nincs telepítve, töltsd le innen:
`https://claude.ai/download` és telepítsd (húzd az Applications mappába).

### 3. lépés – Extensions megnyitása
A menüsorban **Claude → Settings** (vagy `⌘ ,`) → a bal oldali menüben
**Extensions** (Bővítmények).

### 4. lépés – A bővítmény behúzása
- Húzd rá a letöltött `.mcpb` fájlt az Extensions ablakra,
  **vagy** kattints az **Install Extension / Advanced settings** gombra és
  tallózd be a fájlt.
- A Claude Desktop megmutatja a bővítmény adatait (DMS One Flex, 19 eszköz).

### 5. lépés – Konfiguráció kitöltése
Megjelenik egy űrlap. Töltsd ki:
- **Flex token** *(kötelező)* – ide másold be az 1. pontban szerzett tokent.
- **Flex API URL** – alapból `https://flex.dmsone.hu/api`, csak akkor írd át, ha
  saját szervert használtok.
- **Hitelesítési mód** – `pat` (alapértelmezett) vagy `station`.
- **Impersonált felhasználó email** – csak `station` módban töltsd ki.
- **SSL hibák figyelmen kívül hagyása** – maradjon kikapcsolva (csak fejlesztéshez). A publikus
  `https://flex.dmsone.hu/api` URL-en nem is engedett: bekapcsolva a bővítmény indításkor hibával
  leáll.
- **Időzóna** – alapból `Europe/Budapest`. Ebben a zónában értelmezi a szerver a
  határidőket és a tervezett kezdéseket; csak akkor írd át, ha más zónában dolgozol.
- **Letöltési könyvtár** – hova kerüljenek a letöltött csatolmányok (üresen az
  ideiglenes mappa `dmsone-flex` almappájába). A letöltés csak ebbe a mappába vagy
  alkönyvtárába írhat, meglévő fájlt nem ír felül.
- **Letöltési méretkorlát (MB)** – alapból `50`. Ennél nagyobb csatolmányt a
  bővítmény nem tölt le, hanem hibát ad (a fájl teljes egészében a memóriába
  kerül). Csak akkor emeld, ha tényleg nagyobb mellékleteket kell letöltened.

### 6. lépés – Engedélyezés
Kattints a **Save / Enable** (Mentés / Engedélyezés) gombra. A bővítmény
bekapcsol, és a Flex eszközök elérhetővé válnak.

### 7. lépés – Ellenőrzés
Nyiss egy új beszélgetést, és írd be:
> *Ellenőrizd a Flex kapcsolatot.*

Claude lefuttatja a `flex_diag` eszközt. Ha választ kapsz hibaüzenet nélkül,
a telepítés sikeres. 401-es hiba esetén a token hibás vagy lejárt.

---

## B) Manuális telepítés (Node.js) — fejlesztőknek

Ezt csak akkor használd, ha a forrásból futtatnád (pl. fejlesztés, testreszabás).

### 1. lépés – Node.js telepítése
Telepítsd a **Node.js 20+** verziót: `https://nodejs.org` (LTS ajánlott),
vagy Homebrew-val: `brew install node`. Ellenőrzés Terminálban:
```bash
node --version
```

### 2. lépés – A forrás beszerzése és buildelése
Csomagold ki a projektet, majd Terminálban:
```bash
cd "/Users/<felhasznalo>/Documents/Claude/DMS MCP/Flex"
npm install
npm run build
```
Ez létrehozza a `dist/index.js` fájlt.

### 3. lépés – A Claude Desktop konfiguráció szerkesztése
Nyisd meg (vagy hozd létre) ezt a fájlt:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```
> Tipp: Finderben **Megnyitás → Ugrás a mappához** (`⇧⌘G`), és illeszd be a fenti utat.

Illeszd be (a `dist/index.js` **teljes** elérési útjával):
```json
{
  "mcpServers": {
    "dmsone-flex": {
      "command": "node",
      "args": ["/Users/<felhasznalo>/Documents/Claude/DMS MCP/Flex/dist/index.js"],
      "env": {
        "FLEX_TOKEN": "ide-jon-a-tokened",
        "FLEX_BASE_URL": "https://flex.dmsone.hu/api",
        "FLEX_AUTH_METHOD": "pat"
      }
    }
  }
}
```
Station token + impersonáció esetén:
```json
"env": {
  "FLEX_TOKEN": "a-station-token",
  "FLEX_AUTH_METHOD": "station",
  "FLEX_IMPERSONATED_EMAIL": "user@dmsone.hu"
}
```

### 4. lépés – Claude Desktop újraindítása
Lépj ki teljesen (`⌘ Q`), majd indítsd újra. A Flex eszközök ezután elérhetők.

---

## Használat (példák)

A telepítés után egyszerűen, természetes nyelven kérd Claude-tól. Néhány példa:

- **Feladataim:**
  > *Listázd a folyamatban lévő feladataimat.*
  > *Milyen munkafolyamat-feladataim vannak?*

- **Folyamat indítása custom mezőkkel:**
  > *Milyen munkafolyamat-sablonokat indíthatok?*
  > *Indíts egy számla-jóváhagyási folyamatot. A felelős Nagy Péter, a nettó összeg
  >  400 000 Ft, fizetési mód átutalás.*
  >
  > Claude előbb lekéri a sablon mezőit (`flex_workflow_get_template_details`),
  > kitölti a kötelezőeket, és ha valami hiányzik, rákérdez.

- **Feladat elvégzése:**
  > *Nézd meg a 4521-es munkafolyamat-feladat részleteit, majd hagyd jóvá
  >  „Rendben" megjegyzéssel.*

- **Irat keresése azonosító alapján:**
  > *Keresd meg a DMS/13/2023 azonosítójú iratot.*

- **Csatolmányok:**
  > *Listázd a 4521-es feladat csatolmányait, és töltsd le az elsőt.*

- **Felhasználó keresése:**
  > *Keresd meg a „nagy" nevű felhasználókat.*

---

## Hibaelhárítás

| Tünet | Megoldás |
|---|---|
| A bővítmény nem indul el | Add meg a **Flex tokent** a konfigurációban (kötelező). |
| `401 Unauthorized` | A token lejárt/hibás. Generálj újat a Flexben, és frissítsd. |
| `403 Forbidden` | Nincs jogosultság – ellenőrizd a token jogait / az impersonált usert. |
| `404 Not Found` | Hibás azonosító (taskId / wfTaskId / templateId / GUID). |
| Nem éri el a szervert | Ellenőrizd a **Flex API URL**-t és a hálózati/VPN elérést. |
| (Manuális) `node not found` | Telepítsd a Node.js 20+ verziót, és indítsd újra a Claude Desktopot. |
| (Manuális) nem töltődnek be az eszközök | Ellenőrizd a `claude_desktop_config.json` elérési útját és hogy érvényes JSON-e. |

A token a konfigban titkosan (sensitive) tárolódik. Ha kiszivárgott, vond vissza a
Flexben és generálj újat.
