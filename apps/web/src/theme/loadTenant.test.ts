import { describe, expect, it, vi } from 'vitest';
import { loadTenant, resolveTenantId } from './loadTenant';
import { acme, meridian } from './tenants';

/** A fetch that answers with the given body, or a failure. */
const respondWith = (body: unknown, ok = true, status = 200) =>
  vi.fn(async () =>
    ({ ok, status, json: async () => body }) as unknown as Response,
  ) as unknown as typeof fetch;

const failWith = (error: Error) =>
  vi.fn(async () => {
    throw error;
  }) as unknown as typeof fetch;

describe('resolveTenantId', () => {
  it('prefers the query parameter, so a demo can be linked at a brand', () => {
    expect(resolveTenantId('?tenant=meridian')).toBe('meridian');
  });

  it('falls back to the default when nothing is specified', () => {
    expect(resolveTenantId('')).toBe(acme.id);
  });
});

describe('loadTenant', () => {
  it('uses a served document when one is available', async () => {
    const document = { ...meridian, brand: { name: 'Renamed', initials: 'RN' } };
    const result = await loadTenant('meridian', respondWith(document));

    expect(result.source).toBe('remote');
    expect(result.tenant.brand.name).toBe('Renamed');
    expect(result.issues).toEqual([]);
  });

  it('merges a partial document over the bundled tenant of the same id', async () => {
    // A document that only restates colours must keep that tenant's copy,
    // not silently inherit the default tenant's wording.
    const result = await loadTenant('meridian', respondWith({ palette: { primary: '#123456' } }));

    expect(result.tenant.palette.primary).toBe('#123456');
    expect(result.tenant.copy.inputPlaceholder).toBe(meridian.copy.inputPlaceholder);
    expect(result.tenant.shape.radius).toBe(meridian.shape.radius);
  });

  describe('when the document cannot be used', () => {
    it('falls back rather than failing on a 404', async () => {
      const result = await loadTenant('meridian', respondWith(null, false, 404));

      expect(result.source).toBe('bundled');
      expect(result.tenant.id).toBe('meridian');
      expect(result.issues[0]?.message).toMatch(/404/);
    });

    it('falls back rather than failing when the network is down', async () => {
      const result = await loadTenant('acme', failWith(new TypeError('Failed to fetch')));

      expect(result.source).toBe('bundled');
      expect(result.issues[0]?.message).toMatch(/request failed/);
    });

    it('reports a timeout distinctly, because it means something different', async () => {
      const result = await loadTenant(
        'acme',
        failWith(new DOMException('Aborted', 'AbortError')),
      );

      expect(result.issues[0]?.message).toMatch(/no response within/);
    });

    it('marks an unknown tenant as a fallback, not as its own bundle', async () => {
      const result = await loadTenant('never-heard-of-it', respondWith(null, false, 404));

      expect(result.source).toBe('fallback');
      expect(result.tenant.id).toBe(acme.id);
    });

    it('renders something even when the document is not an object at all', async () => {
      const result = await loadTenant('acme', respondWith('a string'));

      expect(result.tenant.id).toBe(acme.id);
      expect(result.issues[0]?.message).toMatch(/not an object/);
    });
  });

  it('never rejects — a branding document is not worth an outage', async () => {
    const cases = [
      respondWith(null, false, 500),
      respondWith(undefined),
      failWith(new Error('boom')),
    ];

    for (const impl of cases) {
      await expect(loadTenant('acme', impl)).resolves.toHaveProperty('tenant');
    }
  });
});
