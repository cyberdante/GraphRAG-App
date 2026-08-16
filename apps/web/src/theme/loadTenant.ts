/**
 * Resolving which brand this instance wears, at runtime.
 *
 * The build contains no client's branding. One artifact is deployed for every
 * tenant, and the document is fetched at boot — otherwise onboarding a client
 * means a release, and their colours are baked into a bundle forever.
 *
 * The bundled tenants remain as a fallback. A branding document is not worth an
 * outage: if the fetch fails, is slow, or returns something unusable, the app
 * renders with what it shipped with and says so in the console.
 */

import type { Tenant } from '@ragstone/shared';
import { parseTenant, type TenantIssue } from './tenantDocument';
import { DEFAULT_TENANT_ID, TENANTS } from './tenants';

/** How long to wait before giving up and rendering the fallback. */
const FETCH_TIMEOUT_MS = 2500;

export type TenantSource = 'remote' | 'bundled' | 'fallback';

export interface TenantResolution {
  tenant: Tenant;
  source: TenantSource;
  issues: TenantIssue[];
}

/** Which tenant this instance should render, most specific first. */
export function resolveTenantId(search: string = window.location.search): string {
  const requested = new URLSearchParams(search).get('tenant');
  if (requested) return requested;

  const configured = import.meta.env.VITE_TENANT;
  return typeof configured === 'string' && configured ? configured : DEFAULT_TENANT_ID;
}

function documentUrl(id: string): string {
  const base = import.meta.env.VITE_TENANT_BASE_URL ?? '/tenants';
  return `${String(base).replace(/\/$/, '')}/${encodeURIComponent(id)}.json`;
}

/** The bundled tenant for an id, or the default when it is unknown. */
function bundled(id: string): Tenant {
  return TENANTS[id] ?? TENANTS[DEFAULT_TENANT_ID]!;
}

/**
 * Fetches and validates the tenant document, falling back rather than failing.
 *
 * The fallback base matters: a partial document merges over the bundled tenant
 * of the same id, so a document that only overrides colours keeps that tenant's
 * copy rather than inheriting the default's.
 */
export async function loadTenant(
  id: string = resolveTenantId(),
  fetchImpl: typeof fetch = fetch,
): Promise<TenantResolution> {
  const base = bundled(id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(documentUrl(id), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return {
        tenant: base,
        source: TENANTS[id] ? 'bundled' : 'fallback',
        issues: [
          {
            level: 'warning',
            path: '',
            message: `tenant document returned ${response.status}; using the bundled tenant`,
          },
        ],
      };
    }

    const { tenant, issues } = parseTenant(await response.json(), base);
    return { tenant, source: 'remote', issues };
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === 'AbortError'
        ? `no response within ${FETCH_TIMEOUT_MS}ms`
        : 'the request failed';

    return {
      tenant: base,
      source: TENANTS[id] ? 'bundled' : 'fallback',
      issues: [
        { level: 'warning', path: '', message: `${reason}; using the bundled tenant` },
      ],
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Writes what happened to the console, so a misconfigured deploy is visible. */
export function reportResolution({ tenant, source, issues }: TenantResolution): void {
  if (issues.length === 0) return;

  const repaired = issues.filter((issue) => issue.level === 'repaired');
  const warnings = issues.filter((issue) => issue.level === 'warning');

  console.warn(
    `Tenant "${tenant.id}" resolved from ${source} with ` +
      `${repaired.length} repaired field(s) and ${warnings.length} warning(s).`,
    issues,
  );
}

/**
 * Whether this deployment may show the brand switcher.
 *
 * Off by default and on in development. A client's own deployment must never
 * offer a list of other people's brands — that is a leak of exactly the kind
 * white-labelling exists to prevent — so turning it on is a deliberate act
 * taken by the demo deployment alone.
 */
export function switcherEnabled(): boolean {
  const flag = import.meta.env.VITE_TENANT_SWITCHER;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return Boolean(import.meta.env.DEV);
}

/** The brands this build can offer, for the switcher's list. */
export function availableTenants(): Array<{ id: string; name: string; color: string }> {
  return Object.values(TENANTS).map((tenant) => ({
    id: tenant.id,
    name: tenant.brand.name,
    color: tenant.palette.primary,
  }));
}
