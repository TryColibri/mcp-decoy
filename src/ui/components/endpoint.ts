/**
 * Formats an MCP endpoint for display, without the scheme:
 * `http://localhost:6280/s/weather/mcp` → `localhost:6280/s/weather/mcp`.
 *
 * @param url - The full endpoint URL.
 */
export function displayEndpoint(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/**
 * The MCP endpoint of a server, from the instance's URL template. Falls back
 * to the default address while the instance info is loading.
 *
 * @param urlTemplate - `mcp.urlTemplate` of the instance, with a `{server}` placeholder.
 * @param server - URL slug of the server.
 */
export function serverEndpoint(
  urlTemplate: string | undefined,
  server: string,
): string {
  return (urlTemplate ?? 'http://localhost:6280/s/{server}/mcp').replace(
    '{server}',
    server,
  );
}
