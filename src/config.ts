import { resolve } from "node:path";

/**
 * Configuration loaded from environment variables.
 * Mirrors the credential fields of the n8n Flex node (FlexApi.credentials.ts).
 */
export interface FlexConfig {
  baseUrl: string;
  authMethod: "pat" | "station";
  token: string;
  impersonatedEmail?: string;
  ignoreSsl: boolean;
  /**
   * A letöltési könyvtár abszolút útvonala, vagy `undefined` (ekkor az OS temp
   * `dmsone-flex` almappája — lásd `tools/workflow.ts` `downloadBaseDir`).
   * Abszolút, mert a letöltés sandbox-határa ez a könyvtár: relatív értéknél a
   * határ a Claude Desktop pillanatnyi munkakönyvtárától függne.
   */
  downloadDir?: string;
  /** IANA zónanév; a Flex felé menő dátumok falióra-ideje ebben a zónában értendő. */
  timeZone: string;
}

/**
 * A Flex a dátumokat **helyi** faliórában várja és adja vissza (nincs offset a
 * `YYYY-MM-DD HH:mm:ss` formátumban), ezért a szervernek tudnia kell, melyik
 * zóna a "helyi". Alapértelmezésben a DMS One telepítések zónája.
 */
export const DEFAULT_TIME_ZONE = "Europe/Budapest";

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

/**
 * Elírt vagy nem létező IANA zónanév esetén az `Intl.DateTimeFormat` minden
 * dátumformázásnál `RangeError`-t dobna — ez a hiba a tool-hívásig rejtve
 * maradna. Ezért induláskor egyszer ellenőrzünk, és visszaesünk az
 * alapértelmezettre, hangosan (stderr), hogy a felhasználó lássa.
 */
function resolveTimeZone(value: string | undefined): string {
  const wanted = (value ?? "").trim();
  if (wanted === "") return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: wanted });
    return wanted;
  } catch {
    console.error(
      `FIGYELEM: a FLEX_TIMEZONE értéke ("${wanted}") nem érvényes IANA zónanév — ` +
        `a szerver a(z) ${DEFAULT_TIME_ZONE} zónát használja. ` +
        `Érvényes példák: Europe/Budapest, Europe/Vienna, UTC.`,
    );
    return DEFAULT_TIME_ZONE;
  }
}

export interface ConfigValidation {
  errors: string[];
  warnings: string[];
}

/**
 * A publikus Flex URL hosztneve, amin a TLS-ellenőrzés kikapcsolása nem
 * engedhető meg — ott ez production forgalom, nem fejlesztői önaláírt cert.
 */
const PUBLIC_FLEX_HOST = "flex.dmsone.hu";

/**
 * A `loadConfig()`-tól elkülönítve, hogy a hívó (jelenleg `index.ts`) döntse el,
 * mi történjen hibával/figyelmeztetéssel — a validáció maga nem lép ki és nem ír.
 */
export function validateConfig(config: FlexConfig): ConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.token) {
    errors.push(
      "HIBA: a FLEX_TOKEN környezeti változó kötelező.\n" +
        "Add meg a Flex Personal Access Tokent (vagy Station Tokent) a Claude Desktop\n" +
        "claude_desktop_config.json \"env\" blokkjában, vagy a .env fájlban.",
    );
  }

  if (config.ignoreSsl) {
    let host: string | undefined;
    try {
      host = new URL(config.baseUrl).hostname;
    } catch {
      host = undefined;
    }
    if (host === PUBLIC_FLEX_HOST) {
      errors.push(
        `HIBA: TLS-ellenőrzés kikapcsolása a publikus Flex URL-en (${PUBLIC_FLEX_HOST}) nem engedett.`,
      );
    } else {
      warnings.push("FIGYELEM: TLS-ellenőrzés kikapcsolva — csak fejlesztéshez.");
    }
  }

  if (config.authMethod === "pat" && config.impersonatedEmail) {
    warnings.push(
      "FIGYELEM: PAT módban az impersonáció nem érvényesül; állítsd FLEX_AUTH_METHOD=station-re, vagy hagyd üresen.",
    );
  }

  return { errors, warnings };
}

export function loadConfig(): FlexConfig {
  const baseUrl = (process.env.FLEX_BASE_URL || "https://flex.dmsone.hu/api").replace(/\/+$/, "");
  const authMethod = (process.env.FLEX_AUTH_METHOD || "pat").toLowerCase() === "station" ? "station" : "pat";
  const token = (process.env.FLEX_TOKEN || "").trim();
  const impersonatedEmail = (process.env.FLEX_IMPERSONATED_EMAIL || "").trim() || undefined;
  const ignoreSsl = truthy(process.env.FLEX_IGNORE_SSL);
  const downloadDirRaw = (process.env.FLEX_DOWNLOAD_DIR || "").trim();
  const downloadDir = downloadDirRaw ? resolve(downloadDirRaw) : undefined;
  const timeZone = resolveTimeZone(process.env.FLEX_TIMEZONE);

  return { baseUrl, authMethod, token, impersonatedEmail, ignoreSsl, downloadDir, timeZone };
}
