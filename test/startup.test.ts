import { test, describe } from "node:test";
import assert from "node:assert/strict";

import type { DownloadResult, FlexHttp, RequestOptions } from "../src/client.js";
import { checkTokenOnStart } from "../src/tools/diagnostic.js";

/**
 * `checkTokenOnStart` (P2-5, `FLEX_CHECK_ON_START`) fake `FlexHttp`-en: nem hív
 * hálózatot, ugyanaz az elv, mint a `handlers.test.ts` fake klienseinél.
 */
function fakeHttp(request: (method: "GET" | "POST", url: string, opts?: RequestOptions) => unknown): FlexHttp {
  return {
    async request<T>(method: "GET" | "POST", url: string, opts?: RequestOptions): Promise<T> {
      return request(method, url, opts) as T;
    },
    async download(): Promise<DownloadResult> {
      throw new Error("not used");
    },
  };
}

function captureConsoleError<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => void lines.push(args.join(" "));
  return run()
    .then((result) => ({ result, lines }))
    .finally(() => {
      console.error = original;
    });
}

describe("checkTokenOnStart", () => {
  test("sikeres /diag hívás: nincs figyelmeztetés", async () => {
    let called: [string, string] | undefined;
    const client = fakeHttp((method, url) => {
      called = [method, url];
      return { ok: true };
    });

    const { lines } = await captureConsoleError(() => checkTokenOnStart(client));

    assert.deepEqual(called, ["GET", "/diag"]);
    assert.deepEqual(lines, []);
  });

  test("hibázó /diag hívás: egyetlen stderr-figyelmeztetés, nem dob", async () => {
    const client = fakeHttp(() => {
      throw new Error("kapcsolat megszakadt");
    });

    const { lines } = await captureConsoleError(() => checkTokenOnStart(client));

    assert.equal(lines.length, 1);
    assert.match(lines[0], /FLEX_CHECK_ON_START/);
    assert.match(lines[0], /kapcsolat megszakadt/);
  });
});
