import { test, describe, after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { DownloadTooLargeError, FlexClient } from "../src/client.js";
import { DEFAULT_MAX_DOWNLOAD_MB, loadConfig, type FlexConfig } from "../src/config.js";
import { formatError } from "../src/format.js";

/**
 * A letöltési méretkorlátot **valódi HTTP-n** mérjük, nem fake kliensen: a
 * korlát az axios `maxContentLength`-je, tehát azt kell látni, hogy az axios
 * node-adaptere valóban elvágja a választ. Egy fake `FlexHttp` ezt szükségképpen
 * megkerülné — ott a `download()` implementációja nem is fut le.
 *
 * A szerver kétféleképpen válaszol, mert az axios két helyen ellenőriz:
 *   - `/known`   — `Content-Length`-szel: a kérés a fejléc alapján, letöltés előtt esik el;
 *   - `/unknown` — chunkolva, `Content-Length` nélkül: a folyam közben.
 * A második a fontosabb: egy hazudó vagy hiányzó fejléc nem kerülheti meg a korlátot.
 */
const CHUNK = Buffer.alloc(256 * 1024, 0x41);
const CHUNKS = 8; // 2 MB összesen

let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/known") {
      const body = Buffer.concat(Array.from({ length: CHUNKS }, () => CHUNK));
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.length),
        "Content-Disposition": 'attachment; filename="nagy.bin"',
      });
      res.end(body);
      return;
    }
    if (req.url === "/unknown") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      for (let i = 0; i < CHUNKS; i += 1) res.write(CHUNK);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Content-Disposition": 'attachment; filename="kicsi.txt"',
    });
    res.end("elég kicsi");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function clientWithLimit(maxDownloadBytes: number): FlexClient {
  const config: FlexConfig = {
    baseUrl,
    authMethod: "pat",
    token: "test-token",
    ignoreSsl: false,
    timeZone: "Europe/Budapest",
    maxDownloadBytes,
  };
  return new FlexClient(config);
}

describe("FlexClient.download — méretkorlát", () => {
  test("a korlát alatti fájl átmegy, a fejléc fájlneve megjön", async () => {
    const result = await clientWithLimit(1024 * 1024).download("/kicsi");
    assert.equal(result.data.toString("utf8"), "elég kicsi");
    assert.equal(result.fileName, "kicsi.txt");
  });

  test("Content-Length alapján túl nagy: DownloadTooLargeError, magyar üzenettel", async () => {
    await assert.rejects(
      () => clientWithLimit(1024 * 1024).download("/known"),
      (error: unknown) => {
        assert.ok(error instanceof DownloadTooLargeError);
        assert.match(error.message, /nagyobb a megengedett 1 MB-nál/);
        assert.match(error.message, /FLEX_MAX_DOWNLOAD_MB/);
        return true;
      },
    );
  });

  test("Content-Length nélkül, folyam közben is elvágja", async () => {
    await assert.rejects(
      () => clientWithLimit(512 * 1024).download("/unknown"),
      (error: unknown) => error instanceof DownloadTooLargeError,
    );
  });

  test("a hiba a tool-válaszban is magyarul jelenik meg", async () => {
    const error = await clientWithLimit(1024 * 1024)
      .download("/known")
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    assert.match(formatError(error), /^Hiba: A csatolmány nagyobb a megengedett/);
  });
});

describe("formatError — nyers maxContentLength-hiba tartaléka", () => {
  test("magyar üzenetre cserél, nem az axios angol szövegét adja", () => {
    // Ide csak az kerülhet, ami a `client.download()` fordítását megkerülte;
    // az `AxiosError` alakját utánozzuk, hogy az `isAxiosError` ág fusson.
    const axiosLike = Object.assign(new Error("maxContentLength size of 1048576 exceeded"), {
      isAxiosError: true,
      code: "ERR_BAD_RESPONSE",
      toJSON: () => ({}),
    });
    const text = formatError(axiosLike);
    assert.match(text, /letöltési méretkorlátot/);
    assert.doesNotMatch(text, /maxContentLength/);
  });
});

/** A `loadConfig` env-olvasó, ezért a teszt maga állítja és állítja vissza a változót. */
function withMaxDownloadMb<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.FLEX_MAX_DOWNLOAD_MB;
  if (value === undefined) delete process.env.FLEX_MAX_DOWNLOAD_MB;
  else process.env.FLEX_MAX_DOWNLOAD_MB = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.FLEX_MAX_DOWNLOAD_MB;
    else process.env.FLEX_MAX_DOWNLOAD_MB = previous;
  }
}

describe("FLEX_MAX_DOWNLOAD_MB feloldása", () => {
  const defaultBytes = DEFAULT_MAX_DOWNLOAD_MB * 1024 * 1024;

  test("hiányzó és üres érték: alapértelmezés", () => {
    assert.equal(
      withMaxDownloadMb(undefined, () => loadConfig().maxDownloadBytes),
      defaultBytes,
    );
    assert.equal(
      withMaxDownloadMb("   ", () => loadConfig().maxDownloadBytes),
      defaultBytes,
    );
  });

  test("érvényes érték bájtra váltva, törtszám is", () => {
    assert.equal(
      withMaxDownloadMb("120", () => loadConfig().maxDownloadBytes),
      120 * 1024 * 1024,
    );
    assert.equal(
      withMaxDownloadMb("0.5", () => loadConfig().maxDownloadBytes),
      512 * 1024,
    );
  });

  test("nulla, negatív és nem szám: alapértelmezésre esik vissza, nem nullára", () => {
    // A csendes 0 azt jelentené, hogy minden letöltés hibára fut.
    for (const bad of ["0", "-10", "sok"]) {
      assert.equal(
        withMaxDownloadMb(bad, () => loadConfig().maxDownloadBytes),
        defaultBytes,
        `"${bad}" → alapértelmezés`,
      );
    }
  });
});
