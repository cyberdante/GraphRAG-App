import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_CONVERSATIONS,
  evict,
  plan,
  saveWithRoom,
  survey,
  totalBytes,
} from './eviction';

/** Enough of the Storage surface to be surveyed, and to run out of room. */
function fakeStorage(entries: Record<string, string> = {}): Storage & { map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  } as Storage & { map: Map<string, string> };
}

/** A conversation and its graph, sized and dated. */
function conversation(
  tenant: string,
  id: string,
  { day, graphBytes = 20_000, textBytes = 1_000 }: { day: number; graphBytes?: number; textBytes?: number },
): Record<string, string> {
  const timestamp = new Date(Date.UTC(2026, 0, day)).toISOString();
  return {
    [`ragstone:${tenant}:conversation:${id}`]: JSON.stringify([
      { id: 'm1', role: 'user', content: 'x'.repeat(textBytes), timestamp },
    ]),
    [`ragstone:${tenant}:graph:${id}`]: JSON.stringify({ pad: 'x'.repeat(graphBytes) }),
  };
}

describe('surveying what is stored', () => {
  it('tells conversations, graphs and settings apart', () => {
    const storage = fakeStorage({
      ...conversation('acme', 'c1', { day: 1 }),
      'ragstone:acme:query-history': '[]',
      'ragstone:theme': 'dark',
      'some-other-app:token': 'x',
    });

    const kinds = Object.fromEntries(survey(storage).map((e) => [e.key, e.kind]));

    expect(kinds['ragstone:acme:conversation:c1']).toBe('conversation');
    expect(kinds['ragstone:acme:graph:c1']).toBe('graph');
    expect(kinds['ragstone:acme:query-history']).toBe('settings');
    expect(kinds['some-other-app:token']).toBe('foreign');
  });

  it('dates a conversation by its newest message', () => {
    const storage = fakeStorage({
      'ragstone:acme:conversation:c1': JSON.stringify([
        { timestamp: '2026-01-01T00:00:00.000Z' },
        { timestamp: '2026-03-01T00:00:00.000Z' },
      ]),
    });

    const entry = survey(storage)[0]!;
    expect(entry.lastActivity).toBe(Date.parse('2026-03-01T00:00:00.000Z'));
  });

  it('gives a graph its conversation’s recency', () => {
    // A graph carries no timestamps. Evicting the drawing of an active
    // conversation while keeping a stale one would be exactly backwards.
    const storage = fakeStorage(conversation('acme', 'c1', { day: 20 }));
    const graph = survey(storage).find((e) => e.kind === 'graph')!;

    expect(graph.lastActivity).toBe(Date.UTC(2026, 0, 20));
  });

  it('treats an unreadable conversation as the oldest thing present', () => {
    // So a corrupt blob is the first thing reclaimed, which is the right answer
    // twice over.
    const storage = fakeStorage({ 'ragstone:acme:conversation:bad': '{{{not json' });

    expect(survey(storage)[0]!.lastActivity).toBe(0);
  });
});

describe('what goes first', () => {
  const roomy = { budgetBytes: 10_000_000, maxConversations: 100 };

  it('does nothing while there is room', () => {
    const storage = fakeStorage(conversation('acme', 'c1', { day: 1 }));

    expect(plan(survey(storage), roomy)).toEqual([]);
  });

  it('drops graphs before conversations', () => {
    // Two thirds of the cost, and the words are what someone came back for.
    const storage = fakeStorage({
      ...conversation('acme', 'old', { day: 1 }),
      ...conversation('acme', 'new', { day: 30 }),
    });

    const doomed = plan(survey(storage), { budgetBytes: 25_000, maxConversations: 100 });

    expect(doomed).toContain('ragstone:acme:graph:old');
    expect(doomed).not.toContain('ragstone:acme:conversation:old');
  });

  it('drops the oldest graph first', () => {
    const storage = fakeStorage({
      ...conversation('acme', 'a', { day: 1 }),
      ...conversation('acme', 'b', { day: 10 }),
      ...conversation('acme', 'c', { day: 20 }),
    });

    const doomed = plan(survey(storage), { budgetBytes: 45_000, maxConversations: 100 });

    expect(doomed[0]).toBe('ragstone:acme:graph:a');
  });

  it('reaches for conversations only once the graphs are gone', () => {
    const storage = fakeStorage({
      ...conversation('acme', 'a', { day: 1, textBytes: 5_000 }),
      ...conversation('acme', 'b', { day: 10, textBytes: 5_000 }),
    });

    const doomed = plan(survey(storage), { budgetBytes: 6_000, maxConversations: 100 });

    expect(doomed).toContain('ragstone:acme:graph:a');
    expect(doomed).toContain('ragstone:acme:graph:b');
    expect(doomed).toContain('ragstone:acme:conversation:a');
  });

  it('never touches the conversation on screen', () => {
    const storage = fakeStorage({
      ...conversation('acme', 'current', { day: 1 }),
      ...conversation('acme', 'other', { day: 30 }),
    });

    const doomed = plan(survey(storage), {
      budgetBytes: 1_000,
      maxConversations: 1,
      protect: ['ragstone:acme:conversation:current', 'ragstone:acme:graph:current'],
    });

    expect(doomed).not.toContain('ragstone:acme:conversation:current');
    expect(doomed).not.toContain('ragstone:acme:graph:current');
  });

  it('never reclaims settings, however tight things get', () => {
    // Theme and retrieval preferences are bytes nobody will miss reclaiming,
    // and losing them is a visible regression for no gain.
    const storage = fakeStorage({
      ...conversation('acme', 'c1', { day: 1 }),
      'ragstone:theme': 'dark',
      'ragstone:acme:retrieval': '{"maxHops":4}',
      'ragstone:acme:query-history': '[]',
    });

    const doomed = plan(survey(storage), { budgetBytes: 1, maxConversations: 0 });

    expect(doomed).not.toContain('ragstone:theme');
    expect(doomed).not.toContain('ragstone:acme:retrieval');
    expect(doomed).not.toContain('ragstone:acme:query-history');
  });

  it('leaves other applications on the origin alone', () => {
    const storage = fakeStorage({
      ...conversation('acme', 'c1', { day: 1 }),
      'some-other-app:session': 'x'.repeat(50_000),
    });

    const doomed = plan(survey(storage), { budgetBytes: 1, maxConversations: 0 });

    expect(doomed).not.toContain('some-other-app:session');
  });

  it('caps the number of conversations even when there is room', () => {
    const many = Object.assign(
      {},
      ...Array.from({ length: DEFAULT_MAX_CONVERSATIONS + 5 }, (_, index) =>
        conversation('acme', `c${index}`, { day: index + 1, graphBytes: 10, textBytes: 10 }),
      ),
    );

    const doomed = plan(survey(fakeStorage(many)), { budgetBytes: 10_000_000 });

    // The five oldest, and their graphs with them.
    expect(doomed.filter((key) => key.includes(':conversation:'))).toHaveLength(5);
    expect(doomed).toContain('ragstone:acme:conversation:c0');
    expect(doomed).not.toContain(`ragstone:acme:conversation:c${DEFAULT_MAX_CONVERSATIONS + 4}`);
  });
});

describe('crossing tenants', () => {
  it('reclaims another tenant’s stale data rather than failing a write', () => {
    // The quota is per origin, not per tenant. A per-tenant budget would let
    // whichever tenant is busiest starve the rest until their writes fail.
    const storage = fakeStorage({
      ...conversation('acme', 'fresh', { day: 30 }),
      ...conversation('meridian', 'stale', { day: 1 }),
    });

    const doomed = plan(survey(storage), { budgetBytes: 25_000, maxConversations: 100 });

    expect(doomed).toContain('ragstone:meridian:graph:stale');
    expect(doomed).not.toContain('ragstone:acme:graph:fresh');
  });

  it('is deletion, not disclosure', () => {
    // Worth stating as a test: eviction may cross tenants precisely because it
    // only removes. Nothing here ever reads one tenant's data into another's.
    const storage = fakeStorage({
      ...conversation('acme', 'a', { day: 1 }),
      ...conversation('meridian', 'b', { day: 2 }),
    });

    evict(storage, { budgetBytes: 1, maxConversations: 0 });

    const survivors = [...storage.map.keys()];
    expect(survivors.filter((key) => key.includes(':conversation:'))).toEqual([]);
  });
});

describe('evicting', () => {
  it('removes what it planned and reports the saving', () => {
    const storage = fakeStorage({
      ...conversation('acme', 'a', { day: 1 }),
      ...conversation('acme', 'b', { day: 20 }),
    });
    const before = totalBytes(survey(storage));

    const report = evict(storage, { budgetBytes: 25_000, maxConversations: 100 });

    expect(report.removed.length).toBeGreaterThan(0);
    expect(report.bytesBefore).toBe(before);
    expect(report.bytesAfter).toBeLessThan(report.bytesBefore);
    expect(totalBytes(survey(storage))).toBe(report.bytesAfter);
  });

  it('survives storage disappearing mid-eviction', () => {
    const storage = fakeStorage({ ...conversation('acme', 'a', { day: 1 }) });
    storage.removeItem = () => {
      throw new DOMException('gone');
    };

    expect(() => evict(storage, { budgetBytes: 1, maxConversations: 0 })).not.toThrow();
  });
});

describe('saveWithRoom', () => {
  it('does not touch storage when the write succeeds', () => {
    const storage = fakeStorage(conversation('acme', 'a', { day: 1 }));
    const before = storage.map.size;

    expect(saveWithRoom(storage, () => true)).toBe(true);
    expect(storage.map.size).toBe(before);
  });

  it('makes room and retries when the write fails', () => {
    // The proactive budget is an estimate; the browser counts differently and
    // other tabs share the origin. The authoritative signal is the failure.
    const storage = fakeStorage({
      ...conversation('acme', 'old', { day: 1 }),
      ...conversation('acme', 'new', { day: 30 }),
    });
    const write = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);

    expect(saveWithRoom(storage, write, { budgetBytes: 40_000 })).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(storage.map.has('ragstone:acme:graph:old')).toBe(false);
  });

  it('gives up rather than looping when there is nothing left to reclaim', () => {
    const storage = fakeStorage({ 'ragstone:theme': 'dark' });
    const write = vi.fn().mockReturnValue(false);

    expect(saveWithRoom(storage, write)).toBe(false);
    // Once to discover the failure, and no retry it cannot possibly fix.
    expect(write).toHaveBeenCalledTimes(1);
  });
});
