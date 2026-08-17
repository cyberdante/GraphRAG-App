/**
 * Making room, before the browser refuses to.
 *
 * A conversation with a full graph costs about 35 KB — the drawing is roughly
 * two thirds of that — and localStorage allows something like 5 MB. So a
 * hundred and fifty conversations fill it, and nothing was pruning them. What
 * happens then is not a warning: `setItem` throws, the write is silently lost,
 * and the newest conversation is the one that fails to save.
 *
 * The quota is per *origin*, not per tenant, so eviction has to reason across
 * every tenant this origin serves. That is deliberate and worth being explicit
 * about: it is the opposite of the isolation the storage keys enforce, and it
 * is sound for a different reason. Isolation prevents one tenant *reading*
 * another's data; eviction only deletes, and the alternative — a per-tenant
 * budget — lets whichever tenant is busiest starve the rest until their writes
 * start failing.
 *
 * What goes first is chosen rather than incidental:
 *
 * 1. **Graphs, oldest first.** Two thirds of the cost, and a conversation
 *    without its drawing is still perfectly readable. The question and the
 *    answer are what someone came back for.
 * 2. **Whole conversations, oldest first**, once the graphs are gone.
 * 3. **Never the conversation currently on screen**, and never the settings —
 *    theme and retrieval preferences are bytes nobody will miss reclaiming.
 */

const NAMESPACE = 'ragstone';

/**
 * The ceiling to stay under, in bytes.
 *
 * Deliberately below the ~5 MB browsers typically allow. The exact limit varies
 * by browser and counts UTF-16 code units rather than characters, so aiming at
 * the real number means discovering it by hitting it. A hard failure costs the
 * user their newest conversation; the headroom costs a few old graphs.
 */
export const DEFAULT_BUDGET_BYTES = 3_500_000;

/** Kept navigable as well as small: nobody scrolls back through two hundred. */
export const DEFAULT_MAX_CONVERSATIONS = 50;

export type EntryKind = 'conversation' | 'graph' | 'settings' | 'foreign';

export interface StorageEntry {
  key: string;
  /** UTF-16 code units, which is what the quota is actually spent in. */
  bytes: number;
  kind: EntryKind;
  tenant?: string;
  conversationId?: string;
  /** Epoch ms of the newest message, or 0 when unknown. */
  lastActivity: number;
}

export interface EvictionReport {
  removed: string[];
  bytesBefore: number;
  bytesAfter: number;
}

/** `ragstone:<tenant>:<what>[:<id>]`, or something that is not ours. */
function classify(key: string): { kind: EntryKind; tenant?: string; conversationId?: string } {
  if (!key.startsWith(`${NAMESPACE}:`)) return { kind: 'foreign' };

  const [, tenant, what, id] = key.split(':');
  if (what === 'conversation' && id) return { kind: 'conversation', tenant, conversationId: id };
  if (what === 'graph' && id) return { kind: 'graph', tenant, conversationId: id };
  return { kind: 'settings', tenant };
}

/**
 * When a conversation was last touched.
 *
 * Read from the newest message rather than tracked separately, so there is no
 * index to fall out of step with what is stored. An entry whose timestamps
 * cannot be read sorts as the oldest thing present, which means a corrupt blob
 * is the first thing reclaimed — the right answer twice over.
 */
function lastActivityOf(raw: string | null): number {
  if (!raw) return 0;
  try {
    const messages = JSON.parse(raw) as Array<{ timestamp?: string }>;
    if (!Array.isArray(messages)) return 0;

    let newest = 0;
    for (const message of messages) {
      const at = message?.timestamp ? Date.parse(message.timestamp) : NaN;
      if (Number.isFinite(at) && at > newest) newest = at;
    }
    return newest;
  } catch {
    return 0;
  }
}

/** Everything stored, with enough about each entry to decide its fate. */
export function survey(storage: Storage): StorageEntry[] {
  const entries: StorageEntry[] = [];
  const activity = new Map<string, number>();

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null) continue;

    const raw = storage.getItem(key);
    const { kind, tenant, conversationId } = classify(key);

    if (kind === 'conversation' && conversationId) {
      activity.set(`${tenant}:${conversationId}`, lastActivityOf(raw));
    }

    entries.push({
      key,
      bytes: (raw?.length ?? 0) + key.length,
      kind,
      tenant,
      conversationId,
      lastActivity: 0,
    });
  }

  // A graph inherits its conversation's recency: on its own it carries no
  // timestamps, and evicting the drawing of an active conversation while
  // keeping a stale one would be exactly backwards.
  return entries.map((entry) =>
    entry.conversationId
      ? { ...entry, lastActivity: activity.get(`${entry.tenant}:${entry.conversationId}`) ?? 0 }
      : entry,
  );
}

export function totalBytes(entries: StorageEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}

export interface EvictionOptions {
  budgetBytes?: number;
  maxConversations?: number;
  /** Keys that must survive whatever happens — the conversation on screen. */
  protect?: readonly string[];
}

/**
 * Which keys to drop, in the order they should go.
 *
 * Pure: it decides, and `evict` acts. That split is what lets the policy be
 * tested against a hundred synthetic conversations without a browser.
 */
export function plan(entries: StorageEntry[], options: EvictionOptions = {}): string[] {
  const budget = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const maxConversations = options.maxConversations ?? DEFAULT_MAX_CONVERSATIONS;
  const protected_ = new Set(options.protect ?? []);

  const removable = entries.filter(
    (entry) =>
      !protected_.has(entry.key) && (entry.kind === 'graph' || entry.kind === 'conversation'),
  );

  const oldestFirst = (a: StorageEntry, b: StorageEntry) => a.lastActivity - b.lastActivity;
  const doomed: string[] = [];
  let running = totalBytes(entries);

  // Rule one, independent of size: keep the history navigable. Counted across
  // the origin for the same reason the budget is.
  const conversations = removable
    .filter((entry) => entry.kind === 'conversation')
    .sort(oldestFirst);
  const surplus = Math.max(0, conversations.length - maxConversations);
  const tooOld = new Set(conversations.slice(0, surplus).map((entry) => entry.conversationId));

  for (const entry of removable) {
    if (entry.conversationId && tooOld.has(entry.conversationId)) {
      doomed.push(entry.key);
      running -= entry.bytes;
    }
  }

  const dropped = new Set(doomed);

  // Rule two: get under the ceiling. Graphs before conversations, because the
  // words are the part worth keeping.
  const byPreference = [
    ...removable.filter((entry) => entry.kind === 'graph' && !dropped.has(entry.key)).sort(oldestFirst),
    ...removable
      .filter((entry) => entry.kind === 'conversation' && !dropped.has(entry.key))
      .sort(oldestFirst),
  ];

  for (const entry of byPreference) {
    if (running <= budget) break;
    doomed.push(entry.key);
    running -= entry.bytes;
  }

  return doomed;
}

/** Applies the plan, and reports what it cost. */
export function evict(storage: Storage, options: EvictionOptions = {}): EvictionReport {
  const entries = survey(storage);
  const bytesBefore = totalBytes(entries);
  const doomed = plan(entries, options);

  for (const key of doomed) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage gone mid-eviction. Nothing better to do than stop.
      break;
    }
  }

  return {
    removed: doomed,
    bytesBefore,
    bytesAfter: bytesBefore - entries.filter((e) => doomed.includes(e.key)).reduce((s, e) => s + e.bytes, 0),
  };
}

/**
 * Saves, and makes room if that is what the failure was.
 *
 * The proactive budget is an estimate — the browser counts differently and
 * other tabs share the origin — so the authoritative signal is the write
 * actually failing. On failure this halves the budget and tries once more,
 * which turns a lost conversation into a few reclaimed graphs.
 */
export function saveWithRoom(
  storage: Storage,
  write: () => boolean,
  options: EvictionOptions = {},
): boolean {
  if (write()) return true;

  const budget = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const report = evict(storage, { ...options, budgetBytes: Math.floor(budget / 2) });
  if (report.removed.length === 0) return false;

  console.warn(
    `Storage was full; reclaimed ${report.removed.length} entries ` +
      `(${Math.round((report.bytesBefore - report.bytesAfter) / 1024)} KB).`,
  );
  return write();
}
