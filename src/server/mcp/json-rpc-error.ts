/** Options of `jsonRPCError`. */
export type JSONRPCErrorOptions = {
  /** `error.data`. */
  data?: unknown;
  /** The request body, to answer its `id`. */
  requestBody?: string | null;
};

/**
 * A JSON-RPC error response, as the SDK's transport answers them.
 *
 * @param status - HTTP status.
 * @param code - JSON-RPC error code.
 * @param message - Error message.
 * @param options - Extra data, and the request body whose `id` the error answers.
 */
export function jsonRPCError(
  status: number,
  code: number,
  message: string,
  { data, requestBody }: JSONRPCErrorOptions = {},
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message, ...(data === undefined ? {} : { data }) },
      id: requestIdOf(requestBody ?? null),
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

/** The id of a single JSON-RPC request in `body`, so an error can answer it. */
const requestIdOf = (body: string | null): string | number | null => {
  if (body === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      (typeof parsed.id === 'string' || typeof parsed.id === 'number')
      ? parsed.id
      : null;
  } catch {
    return null;
  }
};
