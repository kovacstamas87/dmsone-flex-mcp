import axios from "axios";

const CHARACTER_LIMIT = 50000;

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Successful tool result carrying the API response as pretty JSON + structured data. */
export function toolJson(data: unknown): ToolResult {
  let text = typeof data === "string" ? data : JSON.stringify(data, null, 2);

  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n... [a válasz csonkolva lett ${text.length} karakterről ${CHARACTER_LIMIT}-re. ` +
      `Szűkítsd a lekérdezést vagy kérj el konkrét elemet.]`;
  }

  const structuredContent =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { result: data };

  return { content: [{ type: "text", text }], structuredContent };
}

/** Error tool result with an actionable, Hungarian message. */
export function toolError(error: unknown): ToolResult {
  return { content: [{ type: "text", text: formatError(error) }], isError: true };
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
    const bodyText = body ? safeJson(body) : undefined;

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
    if (status === undefined) {
      return `Hiba: nem sikerült elérni a Flex API-t (${error.code ?? "ismeretlen hálózati hiba"}). ` +
        `Ellenőrizd a FLEX_BASE_URL-t és a hálózati elérést.`;
    }

    const message = known[status] ?? `A Flex API hibát adott (HTTP ${status}).`;
    return `Hiba: ${message}${bodyText ? `\nVálasz: ${bodyText}` : ""}`;
  }

  if (error instanceof Error) return `Hiba: ${error.message}`;
  return `Hiba: ${String(error)}`;
}

/** Convert an ISO datetime to the MySQL-style format the Flex API expects. */
export function formatDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 19).replace("T", " ");
}
