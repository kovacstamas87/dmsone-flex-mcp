/**
 * Lista-projekció és lapozás a két listázó eszközhöz.
 *
 * Miért van erre szükség: a `/dms/news` egyetlen hívása a fejlesztői rendszeren
 * **21 elemre 70 645 karaktert** adott vissza — ennek 83%-a olyan mező, amihez
 * külön részletező eszköz van. A megoszlás (mért, 2026-09-03):
 *
 *   metaItems 34 666 · attachments 8 585 · comments 6 351 · taskDescription 4 979
 *   possibleResults 2 814 · wfDescription 1 534   →  együtt 58 929 karakter
 *
 * A summary ezeket **kihagyja**, mert a listázás célja a tájékozódás (mi van
 * nálam, mi sürgős, mit nyissak meg), nem a tartalom feldolgozása. Amint a modell
 * kiválasztott egy elemet, a `flex_workflow_get_task_details`, a
 * `flex_workflow_get_task_comments` és a `flex_workflow_get_task_attachments` a
 * teljes adatot megadja — egy elemre, nem huszonegyre.
 *
 * Külön indok mezőnként:
 *   - `taskDescription` / `wfDescription`: a mintában 21-ből 20 elem **HTML**-t
 *     tartalmaz (`<p>`, `<b>`), ami tokenben drága és a modellnek nyersen zajos.
 *   - `metaItems`: a sablon összes metaadat-mezője, elemenként akár 2 806 karakter;
 *     a részletező eszköz ugyanezt adja, kiválasztott elemre.
 *   - `comments` / `attachments`: helyettük **darabszám** megy (`commentCount`,
 *     `attachmentCount`), hogy a modell lássa, van-e mit megnyitni — ez a lista
 *     navigációs szerepéhez elég.
 *   - `possibleResults`: a lezáráshoz kell, azt viszont a `get_task_details`
 *     `possibleWfTaskResults` mezőjéből kell venni, nem a listából.
 *   - `icon`, `isFavorite`, `result`, `taskMetaItems`: felületi/üres mezők.
 *
 * A `full` mód a nyers elemet adja vissza — a leírás ezért mondja, hogy csak
 * egy-két elemre való.
 */

/** A `/dms/news` vegyesen ad `Task` és `WfTask` elemeket; a `type` mező különíti el őket. */
export type NewsItem = Record<string, unknown>;

export type Envelope = {
  total: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  fields: "summary" | "full";
  items: unknown[];
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Egy `/dms/news` elem összefoglalója.
 *
 * A `templateName` a nyers válaszban objektum (`{ id, code, name, version }`),
 * a `/dms/wfTasks/my` viszont lapos `template` + `templateVersion` párt ad. A
 * summary a **laposat** használja mindkét listán, hogy a modellnek egy szótára
 * legyen a két eszközre.
 */
export function summarizeTask(item: NewsItem): Record<string, unknown> {
  const template = item.templateName as Record<string, unknown> | null | undefined;
  const creator = item.creator as Record<string, unknown> | null | undefined;

  return {
    id: item.id,
    type: item.type,
    referenceNumber: item.referenceNumber ?? null,
    subject: item.subject ?? null,
    taskName: item.taskName ?? null,
    status: item.status ?? null,
    taskStatus: item.taskStatus ?? null,
    taskStart: item.taskStart ?? null,
    taskDeadline: item.taskDeadline ?? null,
    template: template ? (template.name ?? null) : null,
    templateVersion: template ? (template.version ?? null) : null,
    creatorName: creator ? (text(creator.userName) ?? null) : null,
    commentCount: count(item.comments),
    attachmentCount: count(item.attachments),
  };
}

/**
 * Egy `/dms/wfTasks/my` elem összefoglalója.
 *
 * Ez a végpont **ma már összefoglaló alakú**: hét lapos kulcs, se HTML, se
 * metaadat-tömb — a mért 137 elem együtt is csak ~24 000 karakter. A summary
 * itt tehát tartalmilag azonos a nyers elemmel; a haszon a `limit`, nem a
 * mezőválogatás. Mégis **engedélyező lista**, nem azonosság: ha a Flex később
 * bővíti a választ (leírás, metaadatok), a lista nem hízik meg magától.
 */
export function summarizeWfTask(item: NewsItem): Record<string, unknown> {
  return {
    wfTaskId: item.wfTaskId,
    wfSubject: item.wfSubject ?? null,
    wfTaskName: item.wfTaskName ?? null,
    status: item.status ?? null,
    type: item.type ?? null,
    template: item.template ?? null,
    templateVersion: item.templateVersion ?? null,
  };
}

/**
 * Lapozás. A túlfutó `offset` üres listát ad `hasMore: false`-szal — nem hiba,
 * csak a lista vége.
 */
export function paginate<T>(items: T[], offset: number, limit: number): {
  page: T[];
  total: number;
  hasMore: boolean;
} {
  const start = Math.min(Math.max(offset, 0), items.length);
  const page = items.slice(start, start + limit);
  return { page, total: items.length, hasMore: start + page.length < items.length };
}

/**
 * A Flex `{ success, result: [...] }` válaszából borítékot épít.
 *
 * Ha a `result` **nem** tömb (a Flex alakot vált, vagy hibaobjektumot ad),
 * `undefined`-et adunk vissza, és a hívó a nyers választ küldi tovább
 * változatlanul. Miért: egy váratlan alak esetén rosszabb csendben elrejteni az
 * adatot, mint kihagyni a lapozást.
 */
export function envelope(
  payload: unknown,
  options: { offset: number; limit: number; fields: "summary" | "full" },
  summarize: (item: NewsItem) => Record<string, unknown>,
): Envelope | undefined {
  const result = (payload as { result?: unknown } | null | undefined)?.result;
  if (!Array.isArray(result)) return undefined;

  const { page, total, hasMore } = paginate(result, options.offset, options.limit);
  const items =
    options.fields === "summary" ? page.map((item) => summarize(item as NewsItem)) : page;

  return {
    total,
    offset: Math.min(Math.max(options.offset, 0), total),
    returned: items.length,
    hasMore,
    fields: options.fields,
    items,
  };
}
