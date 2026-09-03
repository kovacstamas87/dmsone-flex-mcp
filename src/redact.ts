/**
 * Titok-redakció a tool-eredményeken.
 *
 * Miért kell: a Flex `/diag` végpontja visszatükrözi a beérkező kérés fejléceit
 * (köztük az `Authorization: Bearer …`-t) és a backend környezeti változóit
 * (`APP_KEY`, tenant azonosító). Szűrés nélkül a saját tokenünk bekerülne a
 * beszélgetés-naplóba. A szűrés ezért **nem** a `/diag`-nál van, hanem minden
 * tool-eredményen (`toolJson`) és minden API-hibatörzsön (`formatError`) —
 * így egy később hozzáadott eszköz nem tudja véletlenül megkerülni.
 *
 * Kétféleképpen szűr:
 *  - **kulcs alapján**: a gyanús nevű mező értéke egészében `[REDACTED]` lesz
 *    (típustól függetlenül — egy `token: { value: … }` objektum is eltűnik);
 *  - **érték alapján**: a szövegekben a `Bearer …`, a Flex `mvp_…` tokenprefix,
 *    a Laravel-stílusú `base64:…` kulcs, és a `registerSecretValue()`-val
 *    bejelentett konkrét titkok (a saját tokenünk) tűnnek el.
 *
 * A kettő szándékosan átfed: a kulcs-minta akkor is fog, ha a token formátuma
 * változik; az érték-minta akkor is, ha a backend egy váratlan nevű mezőbe teszi.
 *
 * **Kivétel-lista** (`KEY_ALLOWLIST`): jelenleg üres. A Flex API ismert
 * válaszaiban nincs olyan valós mező, amely a kulcs-mintákba esne — a `taskId`,
 * `attachmentGuid`, `templateId`, `possibleWfTaskResults` és a sablon `metadata`
 * mezőkódjai mind tiszták (teszt őrzi). Ha egy jövőbeli Flex-mező mégis ütközik
 * (pl. egy `tokenX` nevű metaadat), ide kell felvenni, és tesztet írni rá.
 */

export const REDACTED = "[REDACTED]";

/** Valós Flex-mezők, amelyeket a kulcs-minták tévesen elkapnának. Lásd a fejkommentet. */
const KEY_ALLOWLIST = new Set<string>([]);

/** Teljes kulcsegyezés (kis/nagybetű-független). */
const SECRET_KEYS = new Set([
  "authorization",
  "http_authorization",
  "proxy-authorization",
  "cookie",
  "cookies",
  "set-cookie",
  "http_cookie",
  "app_key",
]);

/** Részkulcs-egyezés bárhol a kulcs nevében. */
const SECRET_KEY_PARTS = ["token", "secret", "password", "passwd", "apikey", "credential"];

/** Kulcs-végződések (`app_key`, `X-Api-Key`, …). */
const SECRET_KEY_SUFFIXES = ["_key", "-key"];

function isSecretKey(key: string): boolean {
  const name = key.trim().toLowerCase();
  if (KEY_ALLOWLIST.has(name)) return false;
  if (SECRET_KEYS.has(name)) return true;
  if (SECRET_KEY_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return SECRET_KEY_PARTS.some((part) => name.includes(part));
}

/**
 * Bearer-fejléc értéke. A `\S+` helyett szűkebb karakterosztály, hogy egy
 * JSON-ba ágyazott fejléc utáni idézőjelet vagy vesszőt ne nyelje le.
 */
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

/** A Flex tokenek prefixe. */
const FLEX_TOKEN = /\bmvp_[A-Za-z0-9_-]{16,}\b/g;

/** Laravel `APP_KEY` alak — teljes értékre illeszkedik, nem részletre. */
const BASE64_KEY = /^base64:[A-Za-z0-9+/=]{20,}$/;

/**
 * A folyamat saját titkai (a konfigurált token). Az `index.ts` jelenti be
 * induláskor: így akkor is kiesik, ha a formátuma egyik mintára sem illik.
 */
const literalSecrets = new Set<string>();

/**
 * Bejelent egy konkrét titkot, amit minden kimenetből ki kell szűrni.
 * A 8 karakteres alsó határ azért van, hogy egy rövid teszt-token ne
 * redaktáljon szét ártatlan szövegeket.
 */
export function registerSecretValue(value: string | undefined): void {
  const secret = (value ?? "").trim();
  if (secret.length >= 8) literalSecrets.add(secret);
}

/** Csak tesztekhez: a bejelentett titkok törlése. */
export function clearSecretValues(): void {
  literalSecrets.clear();
}

function redactString(text: string): string {
  if (BASE64_KEY.test(text)) return REDACTED;

  let out = text;
  for (const secret of literalSecrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  out = out.replace(BEARER, `Bearer ${REDACTED}`);
  out = out.replace(FLEX_TOKEN, REDACTED);
  return out;
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value) || value instanceof Date) return value;

  // Ciklusvédelem: a JSON-válaszokban nincs kör, de a saját összeállított
  // objektumainkban lehet ismételt hivatkozás — ezért az útvonal elhagyásakor
  // ki is vesszük a halmazból, hogy a kétszer hivatkozott (de nem körkörös)
  // objektum ne essen áldozatul.
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((item) => walk(item, seen));
  } else {
    const obj: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      obj[key] = isSecretKey(key) ? REDACTED : walk(item, seen);
    }
    out = obj;
  }

  seen.delete(value);
  return out;
}

/**
 * Titkoktól megtisztított **másolat**. A bemenetet nem módosítja, a nem
 * érintett értékeket (szám, boolean, null, Buffer, Date) változatlanul adja.
 */
export function redactSecrets(value: unknown): unknown {
  return walk(value, new WeakSet<object>());
}
