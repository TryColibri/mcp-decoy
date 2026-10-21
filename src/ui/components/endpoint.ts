/**
 * Formats an MCP endpoint for display, without the scheme:
 * `http://localhost:6280/s/weather/mcp` → `localhost:6280/s/weather/mcp`.
 *
 * @param url - The full endpoint URL.
 */
export function displayEndpoint(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
