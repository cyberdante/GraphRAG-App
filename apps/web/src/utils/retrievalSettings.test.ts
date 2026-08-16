import { describe, expect, it } from 'vitest';
import {
  BOUNDS,
  DEFAULT_SETTINGS,
  isDefault,
  parseSettings,
  reconcileBackend,
  toRetrievalOptions,
  type RetrievalSettings,
} from './retrievalSettings';

const settings = (overrides: Partial<RetrievalSettings> = {}): RetrievalSettings => ({
  ...DEFAULT_SETTINGS,
  ...overrides,
});

describe('the wire shape', () => {
  it('sends no backend at all when none is chosen', () => {
    // Not an empty string: the service resolves the name against its registry,
    // and '' is a name it does not have. That is a 400 before the stream
    // opens, which reads as a broken query rather than an unset preference.
    const options = toRetrievalOptions(settings({ backend: undefined }));

    expect('backend' in options).toBe(false);
  });

  it('names the backend when one is chosen', () => {
    expect(toRetrievalOptions(settings({ backend: 'cypher' })).backend).toBe('cypher');
  });

  it('sends an empty type filter as empty, meaning every type', () => {
    // The semantics that are easy to invert: the server reads [] as "no
    // filter". Sending every known type instead would look equivalent and
    // silently exclude any type the client had not heard of.
    const options = toRetrievalOptions(settings({ entityTypes: [] }));

    expect(options.graph.entity_types).toEqual([]);
  });

  it('carries the knobs the operator set', () => {
    const options = toRetrievalOptions(
      settings({ maxHops: 4, maxNodes: 300, topK: 12 }),
    );

    expect(options.graph.max_hops).toBe(4);
    expect(options.graph.max_nodes).toBe(300);
    expect(options.top_k).toBe(12);
  });

  it('defaults to searching every entity type', () => {
    // This replaced a hardcoded ['Supplier', 'Shipment', 'RiskSignal'] that
    // nobody chose and nobody could see, silently narrowing every query.
    expect(toRetrievalOptions(DEFAULT_SETTINGS).graph.entity_types).toEqual([]);
  });
});

describe('reading stored settings', () => {
  it('repairs rather than rejects', () => {
    // Someone whose settings will not load cannot reach the control that
    // would fix them.
    expect(parseSettings({ maxHops: 'lots', topK: null })).toEqual(DEFAULT_SETTINGS);
  });

  it('survives absent, malformed and empty storage', () => {
    for (const raw of [null, undefined, '', 42, [], 'nonsense']) {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('clamps values to what the service will accept', () => {
    // A client offering a range the server quietly reduces is worse than one
    // offering less: the knob moves and nothing happens.
    const parsed = parseSettings({ maxHops: 99, maxNodes: 1, topK: 5000 });

    expect(parsed.maxHops).toBe(BOUNDS.maxHops.max);
    expect(parsed.maxNodes).toBe(BOUNDS.maxNodes.min);
    expect(parsed.topK).toBe(BOUNDS.topK.max);
  });

  it('keeps values that are already in range', () => {
    expect(parseSettings({ maxHops: 3, maxNodes: 200, topK: 45 })).toMatchObject({
      maxHops: 3,
      maxNodes: 200,
      topK: 45,
    });
  });

  it('drops entity types that are not strings', () => {
    expect(parseSettings({ entityTypes: ['Supplier', 7, null] }).entityTypes).toEqual([
      'Supplier',
    ]);
  });

  it('treats an empty backend name as unset', () => {
    expect(parseSettings({ backend: '' }).backend).toBeUndefined();
  });
});

describe('reconciling with what the deployment offers', () => {
  it('drops a backend this deployment no longer has', () => {
    // The stored name outlives the deployment that offered it. Sending it
    // anyway earns a 400 and looks like a broken query.
    const reconciled = reconcileBackend(settings({ backend: 'sparql' }), [
      'fixtures',
      'cypher',
    ]);

    expect(reconciled.backend).toBeUndefined();
  });

  it('keeps a backend that is still offered', () => {
    expect(reconcileBackend(settings({ backend: 'cypher' }), ['fixtures', 'cypher']).backend).toBe(
      'cypher',
    );
  });

  it('leaves an unset backend unset', () => {
    expect(reconcileBackend(settings(), ['fixtures']).backend).toBeUndefined();
  });

  it('clears the choice when the service listed nothing', () => {
    // An empty list means the service did not answer. Holding a name we
    // cannot confirm risks failing every query with a stale setting.
    expect(reconcileBackend(settings({ backend: 'cypher' }), []).backend).toBeUndefined();
  });
});

describe('isDefault', () => {
  it('is true for untouched settings', () => {
    expect(isDefault(DEFAULT_SETTINGS)).toBe(true);
  });

  it('notices each knob individually', () => {
    expect(isDefault(settings({ maxHops: 3 }))).toBe(false);
    expect(isDefault(settings({ topK: 31 }))).toBe(false);
    expect(isDefault(settings({ maxNodes: 151 }))).toBe(false);
    expect(isDefault(settings({ backend: 'cypher' }))).toBe(false);
    expect(isDefault(settings({ entityTypes: ['Risk'] }))).toBe(false);
  });
});
