/**
 * MCP **Resources**: olvasható kontextus, amit a felhasználó maga csatol a
 * beszélgetéshez (a Claude Desktop „+" menüjéből), nem a modell hív meg.
 *
 * Miért resource és nem (csak) tool: a három dolog, ami itt kiajánlva van — a
 * sablonlista, egy sablon mezőleírása és a saját teendők — **állapot, nem
 * művelet**. A tool-változatuk megmarad (a modellnek kell, amikor magától
 * navigál), de resource-ként a felhasználó tudja őket előre a kontextusba tenni,
 * anélkül hogy a modellnek először ki kellene találnia, melyik eszközt hívja.
 * A resource-oknak nincs mellékhatásuk, ezért mind a három csak-olvasó végpontot
 * fed — indítás, lezárás, letöltés **nem** kerül ide.
 *
 * A `flex://template/{id}` azért `ResourceTemplate`, mert paraméteres: az `{id}`
 * értékéhez `complete` callback ad javaslatot (`completion/complete`), a
 * sablonlistából, 60 s-os gyorsítótárral.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { FlexHttp } from "./client.js";
import { formatError, resourceJson } from "./format.js";
import { envelope, summarizeTask } from "./projection.js";
import { describeTemplate } from "./tools/workflow.js";
import { withUntrusted } from "./untrusted.js";

/** A `/dms/workflow/availableTemplates` egy eleme, csak amit itt használunk. */
export interface TemplateSummary {
  id: number;
  code?: string;
  name?: string;
  description?: string;
}

/**
 * Sablonlista-gyorsítótár.
 *
 * Miért kell: a `completion/complete` **gépelés közben** érkezik, karakterenként
 * akár többször — Flex-hívás nélkül kell válaszolni a második leütéstől. A TTL
 * rövid (60 s), mert a sablonlista ritkán, de változhat, és egy elavult javaslat
 * itt csak kényelmetlenség: az érdemi hibát a `resources/read` adja, az mindig
 * friss adatot kér.
 *
 * A gyorsítótár **példányonként** él (nem modul-szintű), hogy a tesztek ne
 * lássák egymás állapotát.
 */
export interface TemplateCache {
  /** A sablonlista; hiba esetén dob (a hívó dönti el, mit kezd vele). */
  list(): Promise<TemplateSummary[]>;
  /** Javaslatok a `templateId` argumentumra; **hiba esetén üres lista**, nem kivétel. */
  complete(value: string): Promise<string[]>;
}

const DEFAULT_TTL_MS = 60_000;

function parseTemplates(payload: unknown): TemplateSummary[] {
  const result = (payload as { result?: unknown } | null | undefined)?.result;
  if (!Array.isArray(result)) return [];

  const templates: TemplateSummary[] = [];
  for (const item of result) {
    const info = item as Record<string, unknown>;
    const id = typeof info.id === "number" ? info.id : Number(info.id);
    if (!Number.isInteger(id)) continue;
    templates.push({
      id,
      code: typeof info.code === "string" ? info.code : undefined,
      name: typeof info.name === "string" ? info.name : undefined,
      description: typeof info.description === "string" ? info.description : undefined,
    });
  }
  return templates;
}

export function createTemplateCache(client: FlexHttp, ttlMs: number = DEFAULT_TTL_MS): TemplateCache {
  let cached: { at: number; items: TemplateSummary[] } | undefined;

  const list = async (): Promise<TemplateSummary[]> => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.items;
    const items = parseTemplates(await client.request("GET", "/dms/workflow/availableTemplates"));
    cached = { at: Date.now(), items };
    return items;
  };

  return {
    list,
    async complete(value: string): Promise<string[]> {
      try {
        const items = await list();
        const needle = value.trim().toLocaleLowerCase("hu");
        // A javaslat **maga az érték**, amit az argumentum felvesz — tehát az id
        // szövegként, nem „id — név". Egy díszített javaslatot a kliens
        // változatlanul beírna, és a hívás elszállna a nem szám értéken.
        // A szűrés viszont a névre is illeszkedik, hogy a felhasználó a sablon
        // nevének elgépelésével is megtalálja a számot.
        return items
          .filter(
            (template) =>
              needle === "" ||
              String(template.id).startsWith(needle) ||
              (template.name ?? "").toLocaleLowerCase("hu").includes(needle) ||
              (template.code ?? "").toLocaleLowerCase("hu").includes(needle),
          )
          .map((template) => String(template.id));
      } catch {
        // Gépelés közbeni javaslat: egy Flex-hiba itt ne legyen protokollhiba a
        // felhasználó képernyőjén — üres javaslatlista a helyes viselkedés.
        return [];
      }
    },
  };
}

/** A `resources/read` hibája protokollhiba; a szövege legyen ugyanaz a magyar mondat, mint a tool-oknál. */
function readError(error: unknown): never {
  throw new Error(formatError(error));
}

export function registerResources(server: McpServer, client: FlexHttp, templates: TemplateCache): void {
  server.registerResource(
    "flex-templates",
    "flex://templates",
    {
      title: "Munkafolyamat sablonok",
      description:
        "Az elindítható munkafolyamat-sablonok (id, code, name, description). " +
        "A sablon mezőihez a flex://template/{id} resource való.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: resourceJson({ templates: await templates.list() }),
            },
          ],
        };
      } catch (error) {
        readError(error);
      }
    },
  );

  server.registerResource(
    "flex-template",
    new ResourceTemplate("flex://template/{id}", {
      // Szándékosan nincs `list`: a sablonok felsorolása maga a `flex://templates`
      // resource. Egy `list` callback ugyanazt a Flex-hívást futtatná le újra,
      // valahányszor a kliens a resource-menüt kirajzolja.
      list: undefined,
      complete: { id: (value) => templates.complete(value) },
    }),
    {
      title: "Sablon mezői",
      description:
        "Egy munkafolyamat-sablon metaadat-mezői és indítási adatai. " +
        'A "validation" mondja meg, mennyit érnek a "required" értékek.',
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const raw = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      const templateId = Number(raw);
      if (!Number.isInteger(templateId)) {
        throw new Error(
          `Hiba: a sablon azonosítója egész szám kell legyen, ez érkezett: "${String(raw)}". ` +
            "A lehetséges értékeket a flex://templates resource adja.",
        );
      }

      try {
        const details = await client.request("GET", `/dms/workflow/startDetails/${templateId}`);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: resourceJson(describeTemplate(templateId, details)),
            },
          ],
        };
      } catch (error) {
        readError(error);
      }
    },
  );

  server.registerResource(
    "flex-my-tasks",
    "flex://my-tasks",
    {
      title: "Saját teendők",
      description:
        "A bejelentkezett felhasználó folyamatban lévő teendői (GET /dms/news), " +
        'összefoglaló alakban, az első 20 elem. Vegyes lista: az "idKind" mondja meg, ' +
        "melyik eszközcsalád kezeli az elemet.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const payload = await client.request("GET", "/dms/news", { params: { status: "in-progress" } });
        // Ugyanaz a projekció, mint a `flex_task_list`-en (WF9): a resource a
        // tájékozódásé, a részletek a részletező eszközöké.
        const page = envelope(payload, { offset: 0, limit: 20, fields: "summary" }, summarizeTask);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: resourceJson(withUntrusted(page ?? payload)),
            },
          ],
        };
      } catch (error) {
        readError(error);
      }
    },
  );
}
