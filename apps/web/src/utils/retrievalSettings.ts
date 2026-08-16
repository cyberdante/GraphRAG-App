/**
 * The knobs an operator actually turns, and the bounds they turn between.
 *
 * These were hardcoded in `App.tsx`: two hops, 150 nodes, and an entity-type
 * filter naming three of the six classes for no stated reason. Nobody could
 * change them, and the one that silently narrowed retrieval was invisible.
 *
 * Every value is clamped to what the service will actually accept, taken from
 * `GraphRetrieval` and `Settings` in the API. A client that offers a range the
 * server then quietly reduces is worse than one that offers less: the operator
 * turns the knob, nothing changes, and there is no way to tell why.
 */

import type { RetrievalOptions } from '@ragstone/shared';

export interface RetrievalSettings {
  /** Undefined means "whatever the deployment defaults to", not "none". */
  backend?: string;
  maxHops: number;
  maxNodes: number;
  topK: number;
  /** Empty means every type. A filter nobody chose should not narrow anything. */
  entityTypes: string[];
}

/** Mirrors the server. Changing one side without the other is the bug this avoids. */
export const BOUNDS = {
  maxHops: { min: 1, max: 6 },
  maxNodes: { min: 10, max: 500 },
  topK: { min: 1, max: 90 },
} as const;

export const DEFAULT_SETTINGS: RetrievalSettings = {
  backend: undefined,
  maxHops: 2,
  maxNodes: 150,
  // The service's own top_k_default. Stated here so the UI shows what will
  // happen rather than leaving the field blank and hoping.
  topK: 30,
  entityTypes: [],
};

function clamp(value: number, { min, max }: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Repairs stored settings rather than rejecting them.
 *
 * Same principle as `parseTenant`: a value that has gone stale — a backend the
 * deployment no longer offers, a bound that has since tightened — should cost
 * a fallback, not an unusable panel. Someone whose settings will not load
 * cannot get to the control that would fix them.
 */
export function parseSettings(raw: unknown): RetrievalSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const value = raw as Partial<Record<keyof RetrievalSettings, unknown>>;

  return {
    backend: typeof value.backend === 'string' && value.backend ? value.backend : undefined,
    maxHops:
      typeof value.maxHops === 'number'
        ? clamp(value.maxHops, BOUNDS.maxHops)
        : DEFAULT_SETTINGS.maxHops,
    maxNodes:
      typeof value.maxNodes === 'number'
        ? clamp(value.maxNodes, BOUNDS.maxNodes)
        : DEFAULT_SETTINGS.maxNodes,
    topK:
      typeof value.topK === 'number' ? clamp(value.topK, BOUNDS.topK) : DEFAULT_SETTINGS.topK,
    entityTypes: Array.isArray(value.entityTypes)
      ? value.entityTypes.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

/**
 * Drops a backend the deployment does not offer.
 *
 * The stored name outlives the deployment that offered it — a tenant switch, a
 * store that lost its endpoint, or simply an older browser. Sending it anyway
 * earns a 400 before the stream opens, and the operator sees a failed query
 * rather than a stale setting.
 */
export function reconcileBackend(
  settings: RetrievalSettings,
  available: string[],
): RetrievalSettings {
  if (!settings.backend || available.includes(settings.backend)) return settings;
  return { ...settings, backend: undefined };
}

/** Whether anything differs from the defaults, for the "reset" affordance. */
export function isDefault(settings: RetrievalSettings): boolean {
  return (
    settings.backend === undefined &&
    settings.maxHops === DEFAULT_SETTINGS.maxHops &&
    settings.maxNodes === DEFAULT_SETTINGS.maxNodes &&
    settings.topK === DEFAULT_SETTINGS.topK &&
    settings.entityTypes.length === 0
  );
}

/** Builds the wire shape. The only place settings become a request. */
export function toRetrievalOptions(settings: RetrievalSettings): RetrievalOptions {
  return {
    mode: 'graph_rag',
    graph: {
      max_hops: settings.maxHops,
      max_nodes: settings.maxNodes,
      entity_types: settings.entityTypes,
    },
    // Omitted rather than sent empty, so the service applies its own default
    // instead of resolving a name that means nothing to it.
    ...(settings.backend ? { backend: settings.backend } : {}),
    top_k: settings.topK,
  };
}
