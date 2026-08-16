import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBackends } from './backends';

function respondWith(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchBackends', () => {
  it('returns what the deployment offers', async () => {
    respondWith([
      { name: 'fixtures', description: 'Bundled sample.', default: true },
      { name: 'cypher', description: 'openCypher over Bolt.', default: false },
    ]);

    expect((await fetchBackends()).map((backend) => backend.name)).toEqual([
      'fixtures',
      'cypher',
    ]);
  });

  it('returns nothing rather than throwing when the service is down', async () => {
    // The picker degrades to "deployment default", which is what every request
    // did before a selector existed. A console that will not open is worse.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    expect(await fetchBackends()).toEqual([]);
  });

  it('returns nothing on a non-OK response', async () => {
    respondWith({ detail: 'Not Found' }, false);

    expect(await fetchBackends()).toEqual([]);
  });

  it('survives a body that is not the list it claims', async () => {
    respondWith({ backends: 'soon' });

    expect(await fetchBackends()).toEqual([]);
  });

  it('drops entries that are not backends', async () => {
    respondWith([{ name: 'cypher', description: 'x', default: false }, null, 'fixtures', {}]);

    expect(await fetchBackends()).toHaveLength(1);
  });

  it('does not treat an abort as data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));

    expect(await fetchBackends()).toEqual([]);
  });
});
