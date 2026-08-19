import type { GraphQueryResult } from '@ragstone/shared';

export interface QueryOutcome {
  status: 'ok' | 'refused';
  result?: GraphQueryResult;
  /** Why it was refused, in the words the service used. */
  detail?: string;
}

/**
 * Runs a query somebody typed.
 *
 * A refusal is an outcome rather than an exception: being told `DELETE` is a
 * write is the console working, not failing, and it belongs on screen next to
 * the query that caused it.
 */
export async function runGraphQuery(
  query: string,
  backend: string | undefined,
  /**
   * Values for the query's parameter slots. Present so a query the pipeline
   * issued can be run again as it ran: those queries carry `$keywords` and
   * `$limit`, and rewriting them to be self-contained would replay something
   * other than what happened. The service binds them through the driver.
   */
  parameters?: Record<string, unknown>,
  baseUrl = '',
): Promise<QueryOutcome> {
  try {
    const response = await fetch(`${baseUrl}/api/graph/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        ...(backend ? { backend } : {}),
        ...(parameters && Object.keys(parameters).length ? { parameters } : {}),
      }),
    });

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const detail =
        body && typeof body === 'object' && typeof (body as { detail?: unknown }).detail === 'string'
          ? (body as { detail: string }).detail
          : `The service returned ${response.status}.`;
      return { status: 'refused', detail };
    }

    return { status: 'ok', result: body as GraphQueryResult };
  } catch {
    return { status: 'refused', detail: 'Could not reach the service.' };
  }
}
