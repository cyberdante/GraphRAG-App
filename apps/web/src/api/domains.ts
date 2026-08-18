import type { DomainInfo } from '@ragstone/shared';

/**
 * What this deployment can hold a graph about.
 *
 * The console used to take its entity types from the keys of the tenant's
 * colour map, which meant a type existed because somebody had given it a
 * colour — and changing the palette changed what could be searched for. Types
 * are a property of the subject, not of the branding, so they come from the
 * service that declares them.
 *
 * Failure is not fatal. Without this list the retrieval drawer offers no type
 * filter, which is what it offered before there was one; a console that will
 * not open would be worse.
 */
export async function fetchDomains(baseUrl = '', signal?: AbortSignal): Promise<DomainInfo[]> {
  try {
    const response = await fetch(`${baseUrl}/api/domains`, { signal });
    if (!response.ok) return [];

    const data: unknown = await response.json();
    if (!Array.isArray(data)) return [];

    return data.filter(
      (entry): entry is DomainInfo =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as DomainInfo).id === 'string' &&
        Array.isArray((entry as DomainInfo).classes),
    );
  } catch {
    return [];
  }
}

/**
 * The domain a tenant is about.
 *
 * A tenant naming a domain this deployment does not hold falls back to the
 * declared default rather than losing its type filter entirely — the same
 * choice the service makes, for the same reason.
 */
export function resolveDomain(
  domains: readonly DomainInfo[],
  requested: string | undefined,
): DomainInfo | null {
  if (domains.length === 0) return null;
  return (
    domains.find((domain) => domain.id === requested) ??
    domains.find((domain) => domain.default) ??
    domains[0]!
  );
}
