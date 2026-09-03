import axios, { type AxiosInstance } from "axios";
import { Agent } from "node:https";
import type { FlexConfig } from "./config.js";

export interface RequestOptions {
  body?: unknown;
  params?: Record<string, unknown>;
}

export interface DownloadResult {
  data: Buffer;
  contentType?: string;
  fileName?: string;
}

/**
 * A `FlexClient` publikus felülete, elvonatkoztatva az axios-implementációtól.
 *
 * Miért kell ez a szint: a `register*Tools` függvények (`src/tools/*.ts`) csak
 * ezt a két metódust hívják, sosem az axios-specifikumokat — így a
 * `test/handlers.test.ts` egy egyszerű, memóriában dolgozó fake-et adhat át
 * helyette (rögzített válasz / dobott hiba), élő HTTP-hívás vagy HTTP-mock
 * (pl. `nock`) nélkül. Ez gyorsabb, és nem függ egy külső mock-könyvtár API-jától.
 */
export interface FlexHttp {
  request<T = unknown>(method: "GET" | "POST", url: string, opts?: RequestOptions): Promise<T>;
  download(url: string): Promise<DownloadResult>;
}

/**
 * Thin HTTP client for the DMS One Flex API.
 *
 * Authentication is identical to the n8n node: a Bearer token (PAT or station
 * token) plus an optional `X-Impersonated-User-Email` header when a station
 * token impersonates a user. The header set is static for the process lifetime,
 * so it is configured once on the axios instance.
 */
export class FlexClient implements FlexHttp {
  private readonly http: AxiosInstance;

  constructor(private readonly config: FlexConfig) {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    };
    if (config.authMethod === "station" && config.impersonatedEmail) {
      headers["X-Impersonated-User-Email"] = config.impersonatedEmail;
    }

    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: 60000,
      headers,
      httpsAgent: config.ignoreSsl ? new Agent({ rejectUnauthorized: false }) : undefined,
    });
  }

  /** Perform a JSON request and return the parsed response body. */
  async request<T = unknown>(method: "GET" | "POST", url: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.http.request<T>({
      method,
      url,
      data: opts.body,
      params: opts.params,
      responseType: "json",
    });
    return res.data;
  }

  /** Download a binary attachment and surface its filename from the headers. */
  async download(url: string): Promise<DownloadResult> {
    const res = await this.http.request({ method: "GET", url, responseType: "arraybuffer" });
    const disposition = (res.headers["content-disposition"] as string | undefined) ?? undefined;
    let fileName: string | undefined;
    if (disposition) {
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
      if (match) {
        try {
          fileName = decodeURIComponent(match[1].trim());
        } catch {
          fileName = match[1].trim();
        }
      }
    }
    return {
      data: Buffer.from(res.data as ArrayBuffer),
      contentType: res.headers["content-type"] as string | undefined,
      fileName,
    };
  }
}
