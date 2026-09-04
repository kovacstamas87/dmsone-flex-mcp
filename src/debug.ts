import { redactSecrets } from "./redact.js";

/**
 * Opt-in nyomkövetés a **kimenő** kérés-törzsekről (stderr).
 *
 * Miért kell: a Flex a hibás törzsre 500-at ad, a hibaüzenet pedig gyakran csak
 * annyit mond, melyik property hiányzik (`Undefined property: …`). Ilyenkor az
 * egyetlen gyors módszer az összevetés a felület saját payloadjával — ehhez
 * látni kell, mit küldtünk. A napló stderr-re megy, mert a stdout az MCP
 * stdio-transzporté: bármi, ami oda kerül, protokollhibát okozna.
 *
 * Miért env és nem `FlexConfig`: ez fejlesztői kapcsoló, nem végfelhasználói
 * beállítás — nincs a `manifest.json` `user_config`-jában, és nem akartuk a
 * konfigurációs felületet egy hibakeresési kapcsolóval bővíteni.
 *
 * A csatolmányok base64 tartalma **nem** kerül a naplóba (egyetlen PDF is
 * megabájtos sorokat írna), és a törzs átmegy a `redactSecrets`-en, hogy egy
 * véletlenül a payloadba került token se szivárogjon ki.
 */
export function isDebugEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test((process.env.FLEX_DEBUG ?? "").trim());
}

/** A `files[].content` base64 blobját méret-jelzésre cseréli. */
function stripFileContents(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const copy = { ...(body as Record<string, unknown>) };
  if (Array.isArray(copy.files)) {
    copy.files = copy.files.map((file) => {
      if (!file || typeof file !== "object") return file;
      const entry = { ...(file as Record<string, unknown>) };
      if (typeof entry.content === "string") entry.content = `<base64, ${entry.content.length} karakter>`;
      return entry;
    });
  }
  return copy;
}

/** Egy kimenő kérés törzse a naplóban — csak `FLEX_DEBUG` bekapcsolt állapotában. */
export function debugRequestBody(label: string, body: unknown): void {
  if (!isDebugEnabled()) return;
  let text: string;
  try {
    text = JSON.stringify(redactSecrets(stripFileContents(body))) ?? String(body);
  } catch {
    text = String(body);
  }
  console.error(`[flex-debug] ${label} kérés-törzs: ${text}`);
}
