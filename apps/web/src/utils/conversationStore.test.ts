import { describe, expect, it } from 'vitest';
import { THEME_KEY, keysFor, purgeLegacyKeys } from './conversationStore';

/**
 * The property under test is isolation, not formatting.
 *
 * Conversations used to live under flat keys shared by every tenant the origin
 * served. One brand switch, one `?tenant=` link, or any deployment resolving
 * the tenant per user, and one client's questions and retrieved subgraphs were
 * readable under another's branding.
 */
describe('conversation storage keys', () => {
  const acme = keysFor('acme');
  const meridian = keysFor('meridian');

  it('gives two tenants entirely disjoint keys', () => {
    const acmeKeys = [
      acme.current,
      acme.history,
      acme.conversation('conv-1'),
      acme.graph('conv-1'),
    ];
    const meridianKeys = [
      meridian.current,
      meridian.history,
      meridian.conversation('conv-1'),
      meridian.graph('conv-1'),
    ];

    // Same conversation id, different tenant: no key may coincide.
    expect(new Set([...acmeKeys, ...meridianKeys]).size).toBe(
      acmeKeys.length + meridianKeys.length,
    );
  });

  it('scopes the enumeration prefix, so a drawer cannot list another tenant', () => {
    expect(acme.conversation('x').startsWith(acme.conversationPrefix)).toBe(true);
    expect(meridian.conversation('x').startsWith(acme.conversationPrefix)).toBe(false);
  });

  it('keeps a conversation and its graph under the same tenant', () => {
    expect(acme.graph('conv-1').startsWith('ragstone:acme:')).toBe(true);
    expect(acme.conversation('conv-1').startsWith('ragstone:acme:')).toBe(true);
  });

  it('does not let one tenant id be a prefix of another', () => {
    // "acme" and "acme-eu" must not share an enumeration prefix, or the first
    // would list the second's conversations.
    const sibling = keysFor('acme-eu');
    expect(sibling.conversation('x').startsWith(acme.conversationPrefix)).toBe(false);
  });

  it('keeps the theme outside tenant scope, because it belongs to the person', () => {
    expect(THEME_KEY).not.toContain('acme');
  });
});

describe('purgeLegacyKeys', () => {
  /** Enough of the Storage surface for the purge to walk. */
  function fakeStorage(entries: Record<string, string>): Storage {
    const map = new Map(Object.entries(entries));
    return {
      get length() {
        return map.size;
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
    } as Storage;
  }

  it('removes conversations written before keys carried a tenant', () => {
    // Scoping new writes does not retract old ones: an upgraded browser still
    // holds the previous schema's conversations, readable under any brand.
    const storage = fakeStorage({
      'ragstone-conversation-conv-1': '[]',
      'ragstone-graph-conv-1': '{}',
      'ragstone-current-conversation-id': 'conv-1',
      'ragstone-query-history': '[]',
    });

    const removed = purgeLegacyKeys(storage);

    expect(removed).toHaveLength(4);
    expect(storage.length).toBe(0);
  });

  it('leaves tenant-scoped keys alone', () => {
    const storage = fakeStorage({
      'ragstone:acme:conversation:conv-1': '[]',
      'ragstone:acme:query-history': '[]',
      'ragstone-query-history': '[]',
    });

    purgeLegacyKeys(storage);

    expect(storage.getItem('ragstone:acme:conversation:conv-1')).toBe('[]');
    expect(storage.getItem('ragstone:acme:query-history')).toBe('[]');
    expect(storage.getItem('ragstone-query-history')).toBeNull();
  });

  it('leaves keys belonging to other applications alone', () => {
    const storage = fakeStorage({ 'some-other-app:token': 'x' });
    purgeLegacyKeys(storage);
    expect(storage.getItem('some-other-app:token')).toBe('x');
  });
});

describe('theme on upgrade', () => {
  function storageWith(entries: Record<string, string>): Storage {
    const map = new Map(Object.entries(entries));
    return {
      get length() {
        return map.size;
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
    } as Storage;
  }

  it('carries the old theme across, because it belongs to the person', () => {
    const storage = storageWith({ 'ragstone-theme': 'dark' });
    purgeLegacyKeys(storage);

    expect(storage.getItem(THEME_KEY)).toBe('dark');
    expect(storage.getItem('ragstone-theme')).toBeNull();
  });

  it('does not overwrite a theme already chosen under the new key', () => {
    const storage = storageWith({ 'ragstone-theme': 'dark', [THEME_KEY]: 'light' });
    purgeLegacyKeys(storage);

    expect(storage.getItem(THEME_KEY)).toBe('light');
  });
});
