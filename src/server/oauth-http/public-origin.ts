/**
 * The public origin of a request: `X-Forwarded-Proto` and `X-Forwarded-Host`
 * when present (so a tunnel in front of the MCP listener gets HTTPS URLs),
 * otherwise the request's own URL and `Host`.
 *
 * @param request - The incoming request.
 */
export function publicOriginOf(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = firstOf(request.headers.get('x-forwarded-proto'));
  const forwardedHost = firstOf(request.headers.get('x-forwarded-host'));
  const protocol = forwardedProto ?? url.protocol.replace(':', '');
  const host = forwardedHost ?? request.headers.get('host') ?? url.host;
  return `${protocol}://${host}`;
}

const firstOf = (header: string | null): string | undefined =>
  header?.split(',')[0]?.trim();
