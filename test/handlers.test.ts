import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import type { DownloadResult, FlexHttp, RequestOptions } from "../src/client.js";
import type { FlexConfig } from "../src/config.js";
import { registerTaskTools } from "../src/tools/task.js";
import { registerWorkflowTools } from "../src/tools/workflow.js";

/**
 * Handler-tesztek a `FlexHttp` interfészen (`src/client.ts`) átadott **fake**
 * klienssel — nem `nock` vagy más HTTP-mock.
 *
 * Miért fake és nem HTTP-mock: a `register*Tools` sosem lát axiost, csak a
 * `request`/`download` metódust — egy egyszerű, memóriában dolgozó objektum,
 * ami rögzített választ ad vagy hibát dob, pontosan ugyanazt a szerepet
 * játssza, mint az élő `FlexClient`, HTTP-réteg és hálózat nélkül. Ez
 * gyorsabb, nem függ egy mock-könyvtár saját (és időnként törékeny)
 * URL-illesztési szabályaitól, és a típusrendszer kényszeríti ki, hogy a fake
 * a valódi felületet implementálja.
 *
 * A tool-hívás a valódi MCP-protokollon megy át (`InMemoryTransport` +
 * `Client.callTool`), nem a `registerTool` belső callback-jét szedjük ki
 * reflexióval — így ugyanaz fut le, amit a `tools-list.test.ts` és végső
 * soron a Claude Desktop is lát (Zod-validáció, `outputSchema`-ellenőrzés),
 * csak a folyamat nem hagyja el a Node-példányt.
 */

type RequestHandler = (method: "GET" | "POST", url: string, opts?: RequestOptions) => unknown;

/** Minimál `FlexHttp` fake: a hívó megadja, mit adjon a `request`/`download`. */
function fakeHttp(handlers: {
  request?: RequestHandler;
  download?: () => Promise<DownloadResult>;
}): FlexHttp {
  return {
    async request<T>(method: "GET" | "POST", url: string, opts?: RequestOptions): Promise<T> {
      if (!handlers.request) throw new Error(`nincs request-fake beállítva: ${method} ${url}`);
      return handlers.request(method, url, opts) as T;
    },
    async download(url: string): Promise<DownloadResult> {
      if (!handlers.download) throw new Error(`nincs download-fake beállítva: ${url}`);
      return handlers.download();
    },
  };
}

const BASE_CONFIG: FlexConfig = {
  baseUrl: "https://flex.example.invalid/api",
  authMethod: "pat",
  token: "test-token",
  ignoreSsl: false,
  timeZone: "Europe/Budapest",
  maxDownloadBytes: 50 * 1024 * 1024,
};

/** Egy `register*Tools`-t egy in-memory szerver-kliens párra köt, és a klienst adja vissza. */
async function connect(register: (server: McpServer) => void): Promise<Client> {
  const server = new McpServer({ name: "handlers-test", version: "0.0.0" });
  register(server);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "handlers-test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** A fixture-ök élő, read-only mintából készültek, anonimizálva — lásd `test/CLAUDE.md`. */
function fixture(name: string): { success: boolean; result: unknown } {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"));
}

const NEWS = fixture("task-list") as { success: boolean; result: Record<string, unknown>[] };
const WF_TASKS = fixture("wf-tasks") as { success: boolean; result: Record<string, unknown>[] };

describe("flex_task_list", () => {
  async function withNewsClient(): Promise<Client> {
    const client = fakeHttp({
      request: (method, url) => {
        assert.equal(method, "GET");
        assert.equal(url, "/dms/news");
        return NEWS;
      },
    });
    return connect((server) => registerTaskTools(server, client, BASE_CONFIG));
  }

  test("summary mód: alapértelmezett limit 20, a boríték és a projekció mezői helyesek", async () => {
    const mcp = await withNewsClient();
    try {
      const result = await mcp.callTool({ name: "flex_task_list", arguments: {} });
      const structured = result.structuredContent as Record<string, unknown>;

      assert.equal(structured.fields, "summary");
      assert.equal(structured.total, NEWS.result.length);
      assert.equal(structured.returned, 20, "az alapértelmezett limit 20");
      assert.equal(structured.hasMore, true, "21 elemből 20 fér az első lapra");

      const items = structured.items as Record<string, unknown>[];
      const first = items[0];
      // A summary engedélyező lista: sem a HTML leírás, sem a metaItems nincs benne.
      assert.ok(!("taskDescription" in first), "a HTML leírás nem kerülhet a summary-be");
      assert.ok(!("metaItems" in first), "a metaItems nem kerülhet a summary-be");
      assert.ok(!("comments" in first), "a nyers comments tömb nem kerülhet a summary-be");
      assert.equal(typeof first.commentCount, "number", "a kommentek száma darabszámmal marad");
      assert.equal(first.idKind, first.type === "WfTask" ? "wfTaskId" : "taskId");
    } finally {
      await mcp.close();
    }
  });

  test("full mód: a nyers elem megy vissza, HTML-lel és metaItems-szel együtt", async () => {
    const mcp = await withNewsClient();
    try {
      const result = await mcp.callTool({
        name: "flex_task_list",
        arguments: { fields: "full", limit: 2 },
      });
      const structured = result.structuredContent as Record<string, unknown>;

      assert.equal(structured.fields, "full");
      assert.equal(structured.returned, 2);
      const items = structured.items as Record<string, unknown>[];
      assert.deepEqual(items, NEWS.result.slice(0, 2), "full módban a nyers elem megy vissza");
    } finally {
      await mcp.close();
    }
  });

  test("limit paraméter: kisebb lapméret, hasMore igaz marad", async () => {
    const mcp = await withNewsClient();
    try {
      const result = await mcp.callTool({
        name: "flex_task_list",
        arguments: { limit: 5, offset: 3 },
      });
      const structured = result.structuredContent as Record<string, unknown>;

      assert.equal(structured.offset, 3);
      assert.equal(structured.returned, 5);
      assert.equal(structured.hasMore, true);
    } finally {
      await mcp.close();
    }
  });
});

describe("flex_workflow_get_my_tasks", () => {
  test("lapoz és összefoglal, a wfTaskId marad az elsődleges azonosító", async () => {
    const client = fakeHttp({
      request: (method, url) => {
        assert.equal(method, "GET");
        assert.equal(url, "/dms/wfTasks/my");
        return WF_TASKS;
      },
    });
    const mcp = await connect((server) => registerWorkflowTools(server, client, BASE_CONFIG));
    try {
      const result = await mcp.callTool({
        name: "flex_workflow_get_my_tasks",
        arguments: { limit: 10 },
      });
      const structured = result.structuredContent as Record<string, unknown>;

      assert.equal(structured.total, WF_TASKS.result.length);
      assert.equal(structured.returned, 10);
      const items = structured.items as Record<string, unknown>[];
      assert.ok(
        items.every((item) => "wfTaskId" in item),
        "minden elemnek van wfTaskId-ja",
      );
    } finally {
      await mcp.close();
    }
  });
});

describe("flex_workflow_get_template_details — includeRaw", () => {
  /** A 66-os sablonhoz hasonló alak: `metadata` kulcsolt objektum, jelölt kötelezőséggel. */
  const START_DETAILS = {
    success: true,
    result: {
      metadata: {
        partnerNev: { code: "partnerNev", name: "Partner neve", type: "Text", required: true },
        megjegyzes: { code: "megjegyzes", name: "Megjegyzés", type: "Text", required: false },
      },
      allowedLinkedItemTypes: ["alszam"],
    },
  };

  async function withTemplateClient(): Promise<Client> {
    const client = fakeHttp({
      request: (method, url) => {
        assert.equal(method, "GET");
        assert.equal(url, "/dms/workflow/startDetails/66");
        return START_DETAILS;
      },
    });
    return connect((server) => registerWorkflowTools(server, client, BASE_CONFIG));
  }

  test("includeRaw hiányában (alapértelmezett hamis) a raw nem kerül a válaszba", async () => {
    const mcp = await withTemplateClient();
    try {
      const result = await mcp.callTool({
        name: "flex_workflow_get_template_details",
        arguments: { templateId: 66 },
      });
      const structured = result.structuredContent as Record<string, unknown>;

      assert.equal(structured.validation, "api-flag", "a fixture jelöl kötelezőséget");
      assert.ok(!("raw" in structured), "alapból nincs raw a válaszban");
      assert.equal((structured.fields as unknown[]).length, 2);
    } finally {
      await mcp.close();
    }
  });

  test("includeRaw: true esetén a nyers startDetails is a válaszban van", async () => {
    const mcp = await withTemplateClient();
    try {
      const result = await mcp.callTool({
        name: "flex_workflow_get_template_details",
        arguments: { templateId: 66, includeRaw: true },
      });
      const structured = result.structuredContent as Record<string, unknown>;

      assert.deepEqual(structured.raw, START_DETAILS, "az includeRaw a teljes startDetails-t adja");
    } finally {
      await mcp.close();
    }
  });
});

describe("flex_workflow_download_attachment — sandbox-lánc fake bufferrel", () => {
  let downloadDir: string;

  after(async () => {
    if (downloadDir) await rm(downloadDir, { recursive: true, force: true });
  });

  async function withDownloadClient(fileName = "napi-jelentes.txt"): Promise<Client> {
    downloadDir = await mkdtemp(join(tmpdir(), "dmsone-flex-handlers-test-"));
    const config: FlexConfig = { ...BASE_CONFIG, downloadDir };
    const client = fakeHttp({
      download: async () => ({
        data: Buffer.from("kitalált csatolmány-tartalom a teszthez"),
        contentType: "text/plain",
        fileName,
      }),
    });
    return connect((server) => registerWorkflowTools(server, client, config));
  }

  test("a fájl a letöltési könyvtárba kerül, a válasz a tényleges elérési utat adja", async () => {
    const mcp = await withDownloadClient();
    try {
      const result = await mcp.callTool({
        name: "flex_workflow_download_attachment",
        arguments: { attachmentGuid: "guid-1" },
      });
      const structured = result.structuredContent as Record<string, unknown>;

      assert.equal(structured.success, true);
      assert.equal(structured.fileName, "napi-jelentes.txt");
      assert.ok((structured.filePath as string).startsWith(downloadDir));

      const saved = await readFile(structured.filePath as string, "utf8");
      assert.equal(saved, "kitalált csatolmány-tartalom a teszthez");
    } finally {
      await mcp.close();
    }
  });

  test("savePath a letöltési könyvtár fölé mutat -> hiba, nincs fájl a sandboxon kívül", async () => {
    const mcp = await withDownloadClient();
    try {
      const result = await mcp.callTool({
        name: "flex_workflow_download_attachment",
        arguments: { attachmentGuid: "guid-2", savePath: "../kiszokes.txt" },
      });

      assert.equal(result.isError, true);
      const text = (result.content as { type: string; text: string }[])[0].text;
      assert.ok(/letöltési könyvtár/.test(text), "a hiba a sandbox-korlátra mutat");
    } finally {
      await mcp.close();
    }
  });

  test("ütközésnél a fájl -1 utótagot kap, a régi nem íródik felül", async () => {
    const mcp = await withDownloadClient("ismetlodo.txt");
    try {
      const first = await mcp.callTool({
        name: "flex_workflow_download_attachment",
        arguments: { attachmentGuid: "guid-3" },
      });
      const second = await mcp.callTool({
        name: "flex_workflow_download_attachment",
        arguments: { attachmentGuid: "guid-3" },
      });

      const firstPath = (first.structuredContent as Record<string, unknown>).filePath as string;
      const secondPath = (second.structuredContent as Record<string, unknown>).filePath as string;

      assert.notEqual(firstPath, secondPath);
      assert.ok(
        secondPath.includes("ismetlodo-1"),
        `a második fájlnak -1 utótagot kell kapnia: ${secondPath}`,
      );
      assert.equal(await readFile(firstPath, "utf8"), "kitalált csatolmány-tartalom a teszthez");
    } finally {
      await mcp.close();
    }
  });
});
