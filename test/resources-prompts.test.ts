import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import type { DownloadResult, FlexHttp, RequestOptions } from "../src/client.js";
import { createTemplateCache, registerResources } from "../src/resources.js";
import { registerPrompts } from "../src/prompts.js";

/**
 * WF18 — Resources és Prompts a **valódi protokollon** át (`InMemoryTransport`),
 * fake `FlexHttp` klienssel.
 *
 * Miért protokollon és nem a callback-eket hívva: a kérdés itt pontosan az, hogy
 * a **kliens mit lát** — milyen URI-kkal jelennek meg a resource-ok, milyen
 * argumentumokat hirdet a prompt, és ad-e a `completion/complete` javaslatot.
 * Ezt a regisztráció belsejéből nem lehet őszintén ellenőrizni.
 */

type RequestHandler = (method: "GET" | "POST", url: string, opts?: RequestOptions) => unknown;

function fakeHttp(request: RequestHandler): FlexHttp {
  return {
    async request<T>(method: "GET" | "POST", url: string, opts?: RequestOptions): Promise<T> {
      return request(method, url, opts) as T;
    },
    async download(url: string): Promise<DownloadResult> {
      throw new Error(`nincs download-fake beállítva: ${url}`);
    },
  };
}

const TEMPLATES = {
  success: true,
  result: [
    { id: 7, code: "SZERZ", name: "Szerződés jóváhagyás", description: "Kétlépcsős jóváhagyás" },
    { id: 12, code: "SZAMLA", name: "Számla ellenőrzés", description: "Pénzügyi ellenőrzés" },
    { id: 30, code: "TAVOLLET", name: "Távollét igénylés" },
  ],
};

const START_DETAILS = {
  success: true,
  result: {
    metadata: [
      { code: "nettoOsszeg", name: "Nettó összeg", type: "Number", required: true },
      { code: "megjegyzes", name: "Megjegyzés", type: "Text", required: false },
    ],
    allowedLinkedItemTypes: ["alszam"],
  },
};

/** A `/dms/news` élő, anonimizált mintája — ugyanaz, amit a projekció-tesztek használnak. */
const NEWS = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/task-list.json", import.meta.url)), "utf8"),
) as { success: boolean; result: Record<string, unknown>[] };

/** Alap-fake: minden ismert végpontra válaszol, és számolja a hívásokat. */
function defaultHandler(calls: string[]): RequestHandler {
  return (method, url) => {
    calls.push(`${method} ${url}`);
    if (url === "/dms/workflow/availableTemplates") return TEMPLATES;
    if (url.startsWith("/dms/workflow/startDetails/")) return START_DETAILS;
    if (url === "/dms/news") return NEWS;
    throw new Error(`nem várt végpont: ${url}`);
  };
}

async function connect(request: RequestHandler): Promise<Client> {
  const server = new McpServer({ name: "resources-prompts-test", version: "0.0.0" });
  const client = fakeHttp(request);
  const templates = createTemplateCache(client);
  registerResources(server, client, templates);
  registerPrompts(server, templates);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "resources-prompts-test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return mcp;
}

/** A resource szöveges tartalma JSON-ként — a `text` az egyetlen csatorna. */
async function readJson(mcp: Client, uri: string): Promise<Record<string, unknown>> {
  const result = await mcp.readResource({ uri });
  assert.equal(result.contents.length, 1, `${uri}: nem egy tartalom jött vissza`);
  const content = result.contents[0] as { uri: string; mimeType?: string; text?: string };
  assert.equal(content.uri, uri);
  assert.equal(content.mimeType, "application/json");
  return JSON.parse(content.text ?? "");
}

describe("resources", () => {
  test("a két statikus resource és a sablon-template megjelenik a listákban", async () => {
    const mcp = await connect(defaultHandler([]));
    try {
      const { resources } = await mcp.listResources();
      assert.deepEqual(resources.map((resource) => resource.uri).sort(), [
        "flex://my-tasks",
        "flex://templates",
      ]);
      for (const resource of resources) {
        assert.ok(resource.title, `${resource.uri}: nincs title`);
        assert.ok(resource.description, `${resource.uri}: nincs description`);
      }

      const { resourceTemplates } = await mcp.listResourceTemplates();
      assert.deepEqual(
        resourceTemplates.map((template) => template.uriTemplate),
        ["flex://template/{id}"],
      );
    } finally {
      await mcp.close();
    }
  });

  test("flex://templates a sablonlistát adja, normalizálva", async () => {
    const calls: string[] = [];
    const mcp = await connect(defaultHandler(calls));
    try {
      const data = (await readJson(mcp, "flex://templates")) as {
        templates: { id: number; code?: string; name?: string }[];
      };
      assert.deepEqual(
        data.templates.map((template) => template.id),
        [7, 12, 30],
      );
      assert.equal(data.templates[0].name, "Szerződés jóváhagyás");
      assert.deepEqual(calls, ["GET /dms/workflow/availableTemplates"]);
    } finally {
      await mcp.close();
    }
  });

  test("flex://template/{id} a sablon mezőit adja, a validation jelöléssel", async () => {
    const calls: string[] = [];
    const mcp = await connect(defaultHandler(calls));
    try {
      const data = (await readJson(mcp, "flex://template/7")) as {
        templateId: number;
        validation: string;
        fields: { code: string; required: boolean }[];
        raw?: unknown;
      };
      assert.equal(data.templateId, 7);
      assert.equal(data.validation, "api-flag");
      assert.deepEqual(
        data.fields.map((field) => field.code),
        ["nettoOsszeg", "megjegyzes"],
      );
      // A `raw` a resource-on sincs benne: ugyanaz a payload-döntés, mint a tool-on (WF9).
      assert.equal(data.raw, undefined);
      assert.deepEqual(calls, ["GET /dms/workflow/startDetails/7"]);
    } finally {
      await mcp.close();
    }
  });

  test("flex://template/{id}: nem szám azonosítóra magyar hibát ad, Flex-hívás nélkül", async () => {
    const calls: string[] = [];
    const mcp = await connect(defaultHandler(calls));
    try {
      await assert.rejects(
        () => mcp.readResource({ uri: "flex://template/abc" }),
        /egész szám/,
        "nem a saját, magyar hibaüzenetünk jött vissza",
      );
      assert.deepEqual(calls, [], "elírt azonosítóra nem szabad Flexet hívni");
    } finally {
      await mcp.close();
    }
  });

  test("flex://my-tasks összefoglaló borítékot ad, keretezett felhasználói szöveggel", async () => {
    const mcp = await connect(defaultHandler([]));
    try {
      const result = await mcp.readResource({ uri: "flex://my-tasks" });
      const text = (result.contents[0] as { text?: string }).text ?? "";
      const data = JSON.parse(text) as {
        total: number;
        returned: number;
        fields: string;
        items: Record<string, unknown>[];
        untrustedFields: string[];
      };

      assert.equal(data.total, NEWS.result.length);
      assert.equal(data.fields, "summary");
      assert.ok(data.returned <= 20, "a resource legfeljebb 20 elemet ad");
      // A summary kulcskészlete: se HTML-leírás, se metaadat-tömb (WF9).
      assert.ok(!("taskDescription" in data.items[0]), "a leírás bekerült az összefoglalóba");
      assert.ok("idKind" in data.items[0], "hiányzik az idKind");
      // WF17: a `subject` felhasználói szöveg — a resource szövegében is keretben van.
      assert.ok(data.untrustedFields.length > 0, "nincs jelölt felhasználói mező");
      // A keret a JSON-szöveg belsejében van, ezért az idézőjelek escape-elve látszanak.
      assert.match(
        text,
        /<untrusted source=\\"flex:items\[\]\.subject\\">/,
        "a felhasználói szöveg nincs keretben",
      );
    } finally {
      await mcp.close();
    }
  });

  test("a Flex hibája a resource-on magyar protokollhibaként jelenik meg", async () => {
    const mcp = await connect(() => {
      throw new Error("a Flex nem elérhető");
    });
    try {
      await assert.rejects(() => mcp.readResource({ uri: "flex://templates" }), /Hiba: a Flex nem elérhető/);
    } finally {
      await mcp.close();
    }
  });
});

describe("completion", () => {
  const templateRef = { type: "ref/resource" as const, uri: "flex://template/{id}" };
  const promptRef = { type: "ref/prompt" as const, name: "start-workflow" };

  test("a resource-argumentum id-javaslatai a sablonlistából jönnek", async () => {
    const mcp = await connect(defaultHandler([]));
    try {
      const all = await mcp.complete({ ref: templateRef, argument: { name: "id", value: "" } });
      assert.deepEqual(all.completion.values, ["7", "12", "30"]);

      const byId = await mcp.complete({ ref: templateRef, argument: { name: "id", value: "3" } });
      assert.deepEqual(byId.completion.values, ["30"]);

      // A szűrés a névre is illeszkedik, de az **érték** az id marad — díszített
      // javaslatot a kliens változatlanul beírna, és a hívás elszállna rajta.
      const byName = await mcp.complete({ ref: templateRef, argument: { name: "id", value: "számla" } });
      assert.deepEqual(byName.completion.values, ["12"]);
    } finally {
      await mcp.close();
    }
  });

  test("a prompt templateId argumentuma ugyanazt a javaslatot adja", async () => {
    const mcp = await connect(defaultHandler([]));
    try {
      const result = await mcp.complete({
        ref: promptRef,
        argument: { name: "templateId", value: "szerz" },
      });
      assert.deepEqual(result.completion.values, ["7"]);
    } finally {
      await mcp.close();
    }
  });

  test("a sablonlista gyorsítótárazott: sok javaslat, egy Flex-hívás", async () => {
    const calls: string[] = [];
    const mcp = await connect(defaultHandler(calls));
    try {
      for (const value of ["", "s", "sz", "sze"]) {
        await mcp.complete({ ref: templateRef, argument: { name: "id", value } });
      }
      await mcp.complete({ ref: promptRef, argument: { name: "templateId", value: "sz" } });
      // A gyorsítótárat a resource-ok és a promptok megosztják — ezért egy hívás, nem kettő.
      assert.deepEqual(calls, ["GET /dms/workflow/availableTemplates"]);
    } finally {
      await mcp.close();
    }
  });

  test("Flex-hiba esetén a javaslat üres lista, nem protokollhiba", async () => {
    const mcp = await connect(() => {
      throw new Error("a Flex nem elérhető");
    });
    try {
      const result = await mcp.complete({ ref: templateRef, argument: { name: "id", value: "sz" } });
      assert.deepEqual(result.completion.values, []);
    } finally {
      await mcp.close();
    }
  });
});

describe("prompts", () => {
  test("három prompt van, magyar címmel és leírással", async () => {
    const mcp = await connect(defaultHandler([]));
    try {
      const { prompts } = await mcp.listPrompts();
      assert.deepEqual(prompts.map((prompt) => prompt.name).sort(), [
        "complete-task",
        "daily-summary",
        "start-workflow",
      ]);
      for (const prompt of prompts) {
        assert.ok(prompt.title, `${prompt.name}: nincs title`);
        assert.ok(prompt.description, `${prompt.name}: nincs description`);
      }

      // Az argumentumok opcionálisak: a prompt argumentum nélkül is használható,
      // ilyenkor a vezetés első lépése maga a választás.
      const startArgs = prompts.find((prompt) => prompt.name === "start-workflow")?.arguments ?? [];
      assert.deepEqual(startArgs.map((argument) => argument.name).sort(), ["subject", "templateId"]);
      assert.ok(
        startArgs.every((argument) => argument.required !== true),
        "egy argumentum kötelező lett",
      );
      assert.deepEqual(
        prompts.find((prompt) => prompt.name === "daily-summary")?.arguments ?? [],
        [],
        "a napi összegzésnek nincs argumentuma",
      );
    } finally {
      await mcp.close();
    }
  });

  test("start-workflow: a megadott sablon bekerül, és megerősítést kér indítás előtt", async () => {
    const mcp = await connect(defaultHandler([]));
    try {
      const result = await mcp.getPrompt({
        name: "start-workflow",
        arguments: { templateId: "7", subject: "Bérleti szerződés" },
      });
      assert.equal(result.messages.length, 1);
      const message = result.messages[0];
      assert.equal(message.role, "user");
      const text = (message.content as { type: string; text: string }).text;

      assert.match(text, /azonosítója: 7/);
      assert.match(text, /Bérleti szerződés/);
      assert.match(text, /flex_workflow_get_template_details/);
      assert.match(text, /flex_workflow_start/);
      // A kész-kritérium lelke: a visszavonhatatlan lépés jóváhagyáshoz kötött.
      assert.match(text, /jóváhagyásom után/);
      assert.match(text, /nem vonható vissza/);
      // A `flex_user_get_by_username` orgId-t nem ad (WF14) — a prompt sem ígérheti.
      assert.match(text, /orgId-t \*\*nem\*\* adja meg|az orgId-t \*\*nem\*\*/);
    } finally {
      await mcp.close();
    }
  });

  test("start-workflow argumentum nélkül a sablonválasztással kezd", async () => {
    const mcp = await connect(defaultHandler([]));
    try {
      const result = await mcp.getPrompt({ name: "start-workflow" });
      const text = (result.messages[0].content as { text: string }).text;
      assert.match(text, /Sablon még nincs kiválasztva/);
      assert.match(text, /flex_workflow_list_templates/);
    } finally {
      await mcp.close();
    }
  });

  test("daily-summary a két feladatfogalmat külön kezeli, és nem hajt végre idegen utasítást", async () => {
    const mcp = await connect(defaultHandler([]));
    try {
      const result = await mcp.getPrompt({ name: "daily-summary" });
      const text = (result.messages[0].content as { text: string }).text;
      assert.match(text, /flex_task_list/);
      assert.match(text, /flex_workflow_get_my_tasks/);
      assert.match(text, /Task és WfTask/);
      assert.match(text, /idKind/);
      assert.match(text, /ne hajtsd végre/);
    } finally {
      await mcp.close();
    }
  });

  test("complete-task: az eredménykód forrását és a jóváhagyást is kimondja", async () => {
    const mcp = await connect(defaultHandler([]));
    try {
      const result = await mcp.getPrompt({ name: "complete-task", arguments: { wfTaskId: "4242" } });
      const text = (result.messages[0].content as { text: string }).text;
      assert.match(text, /azonosítója: 4242/);
      assert.match(text, /possibleWfTaskResults/);
      assert.match(text, /flex_workflow_complete_task/);
      assert.match(text, /jóváhagyásom után/);
      // A Task ≠ WfTask keveredés a leggyakoribb hiba — a prompt kimondja a kiutat.
      assert.match(text, /flex_task_complete/);
    } finally {
      await mcp.close();
    }
  });
});
