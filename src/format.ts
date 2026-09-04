import axios from "axios";

import { redactSecrets } from "./redact.js";
import { closeOpenFrames, renderUntrusted } from "./untrusted.js";

const CHARACTER_LIMIT = 50000;

/**
 * A Flex hibaválaszának törzse (HTML hibaoldal is lehet) csonkolva megy vissza:
 * a modellnek a hibaok kell, nem a teljes oldal.
 */
const ERROR_BODY_LIMIT = 2000;

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Successful tool result carrying the API response as pretty JSON + structured data.
 *
 * A redakció itt, a szerializálás **előtt** történik, hogy a `text` és a
 * `structuredContent` ugyanazt a megtisztított adatot lássa.
 *
 * A méretkorlát **mindkét** ágra hat. Korábban csak a `text` csonkolódott, a
 * `structuredContent` teljes egészében ment — így egy nagy válasz a csonkolás
 * ellenére is beterítette a modell kontextusát azon a csatornán, amit a kliens
 * ugyanúgy átad neki. Ez itt csak **védőháló**: az elsődleges eszköz a listázók
 * `limit`/`fields` paramétere (`src/projection.ts`), mert az a kérés oldalán fog,
 * nem a válasz levágásával.
 *
 * A **felhasználó által írt** mezők (`src/untrusted.ts` markerei) itt válnak
 * két csatornára: a `text`-ben `<untrusted source="flex:…">…</untrusted>`
 * keretben, a `structuredContent`-ben puszta szövegként. A redakció a marker
 * `text`-jére is lefut, mert a marker sima objektum, amit a `redactSecrets`
 * kulcsonként másol. A csonkolás a keretezett `text`-en mérődik, és ha a vágás
 * egy keret közepébe esik, a keret záródik a csonkolás-megjegyzés előtt.
 */
export function toolJson(data: unknown): ToolResult {
  const safe = redactSecrets(data);
  const framed = framedText(safe);

  if (framed.truncated) {
    return {
      content: [{ type: "text", text: framed.text }],
      structuredContent: { truncated: true, originalChars: framed.originalChars, note: framed.note },
    };
  }

  const plain = renderUntrusted(safe, "plain");
  const structuredContent =
    plain && typeof plain === "object" && !Array.isArray(plain)
      ? (plain as Record<string, unknown>)
      : { result: plain };

  return { content: [{ type: "text", text: framed.text }], structuredContent };
}

/**
 * Egy MCP **resource** szöveges tartalma (WF18).
 *
 * Ugyanaz a lánc, mint a `toolJson` `text` ágán — redakció, `<untrusted>`
 * keretezés, méret-védőháló —, mert a resource tartalma pontosan ugyanúgy a
 * modell kontextusába kerül. Ami hiányzik: a `structuredContent`, mert a
 * `resources/read` válaszának nincs ilyen csatornája; a csonkolás megjegyzése
 * ezért itt magába a szövegbe kerül.
 */
export function resourceJson(data: unknown): string {
  return framedText(redactSecrets(data)).text;
}

type FramedText =
  { text: string; truncated: false } | { text: string; truncated: true; originalChars: number; note: string };

/** A már redaktált adat keretezett, szükség esetén csonkolt JSON-szövege. */
function framedText(safe: unknown): FramedText {
  const framed = renderUntrusted(safe, "framed");
  const serialized = typeof framed === "string" ? framed : (JSON.stringify(framed, null, 2) ?? "");
  if (serialized.length <= CHARACTER_LIMIT) return { text: serialized, truncated: false };

  const note =
    `A válasz csonkolva lett ${serialized.length} karakterről ${CHARACTER_LIMIT}-re. ` +
    `Szűkítsd a lekérdezést (limit / fields: "summary") vagy kérj el konkrét elemet.`;
  const head = closeOpenFrames(serialized.slice(0, CHARACTER_LIMIT));
  return { text: `${head}\n\n... [${note}]`, truncated: true, originalChars: serialized.length, note };
}

/** Error tool result with an actionable, Hungarian message. */
export function toolError(error: unknown): ToolResult {
  return { content: [{ type: "text", text: formatError(error) }], isError: true };
}

/** A bináris hibatörzs szöveggé alakítása, hogy a redakció lásson bele. */
function normalizeBody(value: unknown): unknown {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function truncateBody(text: string): string {
  return text.length > ERROR_BODY_LIMIT ? `${text.slice(0, ERROR_BODY_LIMIT)}… [csonkolva]` : text;
}

function safeJson(value: unknown): string {
  try {
    if (Buffer.isBuffer(value)) return value.toString("utf8");
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const body = error.response?.data;
    const bodyText = body ? truncateBody(safeJson(redactSecrets(normalizeBody(body)))) : undefined;

    const known: Record<number, string> = {
      400: "Hibás kérés (400). Ellenőrizd a kötelező mezőket és a paraméterek formátumát.",
      401: "Érvénytelen vagy lejárt token (401). Frissítsd a FLEX_TOKEN értékét a konfigurációban.",
      403: "Nincs jogosultság (403). Ellenőrizd a token jogait, illetve station tokennél az impersonált felhasználót.",
      404: "Az erőforrás nem található (404). Ellenőrizd az azonosítót (taskId / wfTaskId / templateId / GUID).",
      500: "A Flex szerver belső hibát adott (500). Próbáld újra később.",
    };

    if (error.code === "ECONNABORTED") {
      return "Hiba: a kérés időtúllépés miatt megszakadt. Próbáld újra.";
    }
    // Tartalék: a letöltési méretkorlátot a `client.download()` alakítja
    // `DownloadTooLargeError`-rá (az ismeri a beállított MB-értéket). Ide csak
    // az kerül, ami mégis nyers axios-hibaként jut el idáig — az angol,
    // bájtszámot közlő szöveg helyett magyar üzenetet adunk.
    if (/maxContentLength/i.test(error.message)) {
      return (
        "Hiba: a válasz meghaladta a beállított letöltési méretkorlátot. " +
        "Emeld a FLEX_MAX_DOWNLOAD_MB értékét, vagy töltsd le a fájlt a Flex felületéről."
      );
    }
    if (status === undefined) {
      return (
        `Hiba: nem sikerült elérni a Flex API-t (${error.code ?? "ismeretlen hálózati hiba"}). ` +
        `Ellenőrizd a FLEX_BASE_URL-t és a hálózati elérést.`
      );
    }

    const message = known[status] ?? `A Flex API hibát adott (HTTP ${status}).`;
    return `Hiba: ${message}${bodyText ? `\nVálasz: ${bodyText}` : ""}`;
  }

  if (error instanceof Error) return `Hiba: ${error.message}`;
  return `Hiba: ${String(error)}`;
}

/**
 * A Flex-nek szánt dátum egyetlen elfogadott alakja: `YYYY-MM-DD`, opcionálisan
 * `[T ]HH:mm[:ss][.ms]`, opcionálisan offsettel (`Z`, `+02:00`, `+0200`, `-05`).
 */
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

/**
 * A minta illeszkedése még nem jelent valódi időpontot: a `2026-13-45` és a
 * `2026-02-30` is átmegy rajta. Ezeket vissza kell utasítani, különben egy
 * elírásból hihető kinézetű, de hamis érték kerülne a Flexbe.
 */
function isRealDateTime(parts: string[]): boolean {
  const [year, month, day, hour, minute, second] = parts.map(Number);
  if (hour > 23 || minute > 59 || second > 59) return false;

  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** A `+0200` / `-05` alakot is `±hh:mm`-re hozzuk, hogy a `Date` biztosan értse. */
function normalizeOffset(offset: string): string {
  if (/^z$/i.test(offset)) return "Z";
  const sign = offset[0];
  const digits = offset.slice(1).replace(":", "");
  return `${sign}${digits.slice(0, 2)}:${digits.slice(2, 4) || "00"}`;
}

/**
 * Egy időpillanat falióra-ideje a megadott zónában, a Flex formátumában.
 *
 * `Intl.DateTimeFormat` + `formatToParts` — nincs külön időzóna-függőség
 * (`date-fns-tz` stb.), a Node 20 full-ICU build ezt tudja. A `hourCycle: "h23"`
 * kell, különben az en-US formázó alapból 12 órás, éjfélre pedig `24`-et adna.
 *
 * A zónanév érvényességéért a `loadConfig` felel (`resolveTimeZone`): elírt
 * zónanévvel az `Intl` itt `RangeError`-t dobna.
 */
function wallClockInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return (
    `${part("year")}-${part("month")}-${part("day")} ` + `${part("hour")}:${part("minute")}:${part("second")}`
  );
}

/**
 * A Flex-nek szánt `YYYY-MM-DD HH:mm:ss` alak előállítása.
 *
 * A Flex API **helyi faliórát** vár és ad vissza — a dátummezőkben nincs offset.
 * Ezért:
 *   - offset **nélküli** bemenetet változatlan faliórának veszünk (csak
 *     normalizálunk), nem tolunk el semmit;
 *   - offsettel megadott bemenetet átszámítunk a konfigurált zóna faliórájára
 *     (`FLEX_TIMEZONE`, alap `Europe/Budapest`);
 *   - csak dátum esetén a nap kezdete (`00:00:00`);
 *   - értelmezhetetlen bemenetet változatlanul visszaadunk, hogy a Flex saját
 *     hibaüzenete jusson el a felhasználóhoz — ez a korábbi viselkedés.
 *
 * Miért nem `toISOString()`, ahogy korábban: az **mindig UTC-re** konvertált,
 * így egy `2026-08-18T23:59:59+02:00` határidő `21:59:59`-ként ment be a
 * Flexbe — nyáron két órával korábbra. Ez volt a P0-5 hiba.
 */
export function formatDateTime(value: string | undefined, timeZone: string): string {
  if (!value) return "";

  const match = DATE_TIME.exec(value.trim());
  if (!match) return value;

  const [, year, month, day, hour = "00", minute = "00", second = "00", offset] = match;
  if (!isRealDateTime([year, month, day, hour, minute, second])) return value;

  if (offset) {
    const instant = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${normalizeOffset(offset)}`);
    if (Number.isNaN(instant.getTime())) return value;
    return wallClockInZone(instant, timeZone);
  }

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * A **csak dátum** alakú (`YYYY-MM-DD`) mezők formázása.
 *
 * A `POST /dms/workflow/start` `deadline` mezőjét a Flex felülete dátumként
 * küldi (`2026-09-25`), idő nélkül — ezt követjük, hogy a tool payloadja a
 * felületivel egyezzen. A falióra-átszámítás előbb lefut (offsettel megadott
 * érték a `FLEX_TIMEZONE` zónájára), és csak utána vágunk: így egy
 * `2026-09-25T23:30:00+05:00` a budapesti nap szerinti dátumot adja, nem a
 * bemeneti zónáét. Értelmezhetetlen bemenetet a `formatDateTime` változatlanul
 * ad vissza — azt itt sem csonkoljuk, hogy a Flex saját hibaüzenete jusson el
 * a felhasználóhoz.
 */
export function formatDate(value: string | undefined, timeZone: string): string {
  const formatted = formatDateTime(value, timeZone);
  return /^\d{4}-\d{2}-\d{2}/.test(formatted) ? formatted.slice(0, 10) : formatted;
}
