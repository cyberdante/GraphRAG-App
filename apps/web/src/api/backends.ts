import type { BackendInfo } from '@ragstone/shared';

/**
 * What this deployment can retrieve from.
 *
 * The list is the server's to give: a request names a backend and never an
 * endpoint, and the registry is built from the deployment's own settings. So
 * the picker offers exactly what is on offer, and a store that cannot reach
 * anything is absent rather than listed and broken.
 *
 * Failure is not fatal. Without this list the controls fall back to "whatever
 * the deployment defaults to", which is what every request did before the
 * selector existed — a degraded picker beats a console that will not open.
 */
export async function fetchBackends(
  baseUrl = '',
  signal?: AbortSignal,
): Promise<BackendInfo[]> {
  try {
    const response = await fetch(`${baseUrl}/api/backends`, { signal });
    if (!response.ok) return [];

    const data: unknown = await response.json();
    if (!Array.isArray(data)) return [];

    return data.filter(
      (entry): entry is BackendInfo =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as BackendInfo).name === 'string',
    );
  } catch {
    return [];
  }
}
