import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DomainInfo } from '@ragstone/shared';
import { fetchDomains, resolveDomain } from './domains';

const SUPPLY: DomainInfo = {
  id: 'supply-chain',
  label: 'Supply chain',
  version: '1.0.0',
  classes: ['Supplier', 'Risk'],
  starters: ['Which suppliers are at risk?'],
  presets: [], ontology: '/ontology/supply-chain.ttl',
  default: true,
};

const CLINICAL: DomainInfo = {
  ...SUPPLY,
  id: 'clinical-trials',
  label: 'Clinical trials',
  classes: ['Trial', 'Site'],
  starters: ['Show enrolment by site'],
  presets: [], ontology: '/ontology/clinical-trials.ttl',
  default: false,
};

afterEach(() => vi.unstubAllGlobals());

function respondWith(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => body }));
}

describe('fetchDomains', () => {
  it('returns what the deployment declares', async () => {
    respondWith([SUPPLY, CLINICAL]);

    expect((await fetchDomains()).map((d) => d.id)).toEqual(['supply-chain', 'clinical-trials']);
  });

  it('returns nothing rather than throwing when the service is down', async () => {
    // The drawer then offers no type filter, which is what it offered before
    // there was one. A console that will not open would be worse.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    expect(await fetchDomains()).toEqual([]);
  });

  it('drops entries that are not domains', async () => {
    respondWith([SUPPLY, null, 'clinical-trials', { id: 'x' }]);

    expect(await fetchDomains()).toHaveLength(1);
  });

  it('returns nothing on a non-OK response', async () => {
    respondWith({ detail: 'Not Found' }, false);

    expect(await fetchDomains()).toEqual([]);
  });
});

describe('resolveDomain', () => {
  it('finds the domain a tenant names', () => {
    expect(resolveDomain([SUPPLY, CLINICAL], 'clinical-trials')).toBe(CLINICAL);
  });

  it('falls back to the declared default when the tenant names nothing', () => {
    expect(resolveDomain([CLINICAL, SUPPLY], undefined)).toBe(SUPPLY);
  });

  it('falls back rather than leaving the console with no types', () => {
    // The wrong vocabulary degrades the answers; no vocabulary degrades more.
    expect(resolveDomain([SUPPLY, CLINICAL], 'nonesuch')).toBe(SUPPLY);
  });

  it('takes the first when nothing is marked default', () => {
    const undecided = [{ ...CLINICAL }, { ...SUPPLY, default: false }];

    expect(resolveDomain(undecided, undefined)).toBe(undecided[0]);
  });

  it('reports nothing when the deployment declared nothing', () => {
    expect(resolveDomain([], 'supply-chain')).toBeNull();
  });
});
