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
  downloadDir?: string;
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

export function loadConfig(): FlexConfig {
  const baseUrl = (process.env.FLEX_BASE_URL || "https://flex.dmsone.hu/api").replace(/\/+$/, "");
  const authMethod = (process.env.FLEX_AUTH_METHOD || "pat").toLowerCase() === "station" ? "station" : "pat";
  const token = (process.env.FLEX_TOKEN || "").trim();
  const impersonatedEmail = (process.env.FLEX_IMPERSONATED_EMAIL || "").trim() || undefined;
  const ignoreSsl = truthy(process.env.FLEX_IGNORE_SSL);
  const downloadDir = (process.env.FLEX_DOWNLOAD_DIR || "").trim() || undefined;

  return { baseUrl, authMethod, token, impersonatedEmail, ignoreSsl, downloadDir };
}
