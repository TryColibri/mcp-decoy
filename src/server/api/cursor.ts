/**
 * Log page cursors: the id of the last entry on a page, as a uint64
 * big-endian, base64url-encoded (8 bytes → 11 chars).
 */

const CURSOR_BYTES = 8;

/**
 * Encodes the id of the last entry on a page.
 *
 * @param id - A log entry id.
 */
export function encodeCursor(id: number): string {
  const buffer = Buffer.alloc(CURSOR_BYTES);
  buffer.writeBigUInt64BE(BigInt(id));
  return buffer.toString('base64url');
}

/**
 * Decodes a cursor produced by `encodeCursor`.
 *
 * @param cursor - An opaque cursor from a client.
 * @returns The entry id, or `null` when the cursor is invalid.
 */
export function decodeCursor(cursor: string): number | null {
  if (!/^[A-Za-z0-9_-]{11}$/.test(cursor)) {
    return null;
  }
  const buffer = Buffer.from(cursor, 'base64url');
  if (buffer.length !== CURSOR_BYTES) {
    return null;
  }
  const id = buffer.readBigUInt64BE();
  if (id > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(id);
}
