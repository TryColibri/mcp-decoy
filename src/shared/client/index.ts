import { type ClientRequestOptions, hc } from 'hono/client';

import type { ApiV1 } from '@/server/api';

/**
 * Creates a typed client for decoy's REST API (`/api/v1`).
 *
 * @param baseUrl - Origin of the UI listener, e.g. `http://127.0.0.1:6281`, or
 * `''` for same-origin requests from the SPA.
 * @param options - Extra `hc` options (custom `fetch`, headers, …).
 */
export function createDecoyClient(
  baseUrl: string,
  options?: ClientRequestOptions,
) {
  return hc<ApiV1>(`${baseUrl}/api/v1`, options);
}

/** A typed client for decoy's REST API. */
export type DecoyClient = ReturnType<typeof createDecoyClient>;
