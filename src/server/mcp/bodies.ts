import { MAX_BODY_BYTES } from '@/shared/api';

/** A text cut at `MAX_BODY_BYTES`. */
export type Truncated = {
  /** The text, or its first `MAX_BODY_BYTES` bytes. */
  text: string;
  /** Whether it was cut. */
  truncated: boolean;
};

/**
 * Cuts `text` to `MAX_BODY_BYTES` bytes of UTF-8, without leaving half a
 * character at the end.
 *
 * @param text - A body.
 */
export function truncate(text: string): Truncated {
  const bytes = Buffer.from(text);
  if (bytes.length <= MAX_BODY_BYTES) {
    return { text, truncated: false };
  }
  const cut = bytes.subarray(0, MAX_BODY_BYTES).toString('utf8');
  return {
    text: cut.endsWith('�') ? cut.slice(0, -1) : cut,
    truncated: true,
  };
}

/**
 * A body as the log shows it. A JSON body is its parsed value, a form body
 * decodes to an object, an HTML body becomes `"(HTML, N bytes)"`, anything
 * else (or JSON that doesn't parse) is the text.
 *
 * @param contentType - The `Content-Type` header, or `null` when absent.
 * @param text - The body.
 */
export function bodyOf(contentType: string | null, text: string): unknown {
  const type = contentType ?? '';
  if (type.includes('json')) {
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      return text;
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (type.includes('text/html')) {
    return `(HTML, ${Buffer.byteLength(text)} bytes)`;
  }
  return text;
}
