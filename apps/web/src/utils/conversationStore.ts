/**
 * Where a tenant's conversations live, and why the key says which tenant.
 *
 * Conversations were stored under flat keys — `ragstone-conversation-<id>` —
 * shared by every tenant the origin served. On its own that is invisible,
 * because a client deployment renders one brand. It stops being invisible the
 * moment one origin serves more than one: the brand switcher in the demo, a
 * `?tenant=` link, or any future deployment that resolves the tenant per user.
 * Then one tenant's questions and retrieved subgraphs are readable under
 * another's branding, which is exactly the thing white-labelling is sold as
 * preventing.
 *
 * Scoping the key by tenant makes that structurally impossible rather than
 * something the UI has to remember to clear.
 */

const NAMESPACE = 'ragstone';

/** Settings that belong to the person, not to any tenant. */
export const THEME_KEY = `${NAMESPACE}:theme`;


export interface ConversationKeys {
  /** Which conversation this tenant was last looking at. */
  current: string;
  /** The tenant's query history list. */
  history: string;
  /** Prefix every conversation of this tenant shares, for enumeration. */
  conversationPrefix: string;
  conversation: (conversationId: string) => string;
  graph: (conversationId: string) => string;
}

export function keysFor(tenantId: string): ConversationKeys {
  const base = `${NAMESPACE}:${tenantId}`;
  const conversationPrefix = `${base}:conversation:`;

  return {
    current: `${base}:current-conversation`,
    history: `${base}:query-history`,
    conversationPrefix,
    conversation: (conversationId: string) => `${conversationPrefix}${conversationId}`,
    graph: (conversationId: string) => `${base}:graph:${conversationId}`,
  };
}

/**
 * Drops conversations written under the old unscoped schema.
 *
 * Before keys carried a tenant, everything lived under flat `ragstone-*` keys.
 * Those entries are now unreachable by the app but still sit in the browser,
 * holding one tenant's questions and retrieved subgraphs in a place any tenant
 * rendered by this origin could read. Scoping new writes does not remove what
 * was already written, so the upgrade has to clear it.
 *
 * The theme is carried across rather than dropped, because it belongs to the
 * person rather than to any tenant, and losing it on upgrade would be a
 * regression for no benefit.
 */
export function purgeLegacyKeys(storage: Storage): string[] {
  const legacy = ['ragstone-conversation-', 'ragstone-graph-', 'ragstone-current-conversation', 'ragstone-query-history'];
  const doomed: string[] = [];

  const legacyTheme = storage.getItem('ragstone-theme');
  if (legacyTheme !== null) {
    if (storage.getItem(THEME_KEY) === null) storage.setItem(THEME_KEY, legacyTheme);
    storage.removeItem('ragstone-theme');
  }

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    // A key with the new namespace separator is scoped and must survive.
    if (!key || key.startsWith(`${NAMESPACE}:`)) continue;
    if (legacy.some((prefix) => key.startsWith(prefix))) doomed.push(key);
  }

  doomed.forEach((key) => storage.removeItem(key));
  return doomed;
}

