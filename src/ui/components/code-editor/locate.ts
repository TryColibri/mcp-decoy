import { findNodeAtLocation, type JSONPath, parseTree } from 'jsonc-parser';

/** A span of a text, in UTF-16 code units. */
export type TextRange = {
  /** Offset of the first character. */
  offset: number;
  /** Number of characters. */
  length: number;
};

/**
 * Finds where the value at a JSON path sits in a text. When the path doesn't
 * exist (a missing required property, say), the closest ancestor that does is
 * used; when the text isn't parseable at all, the whole text.
 *
 * @param text - JSON text.
 * @param path - Property names and array indexes leading to the value.
 * @returns The span of the value node.
 */
export function rangeOf(text: string, path: JSONPath): TextRange {
  const root = parseTree(text, [], { allowTrailingComma: true });
  if (root === undefined) {
    return { offset: 0, length: text.length };
  }
  for (let depth = path.length; depth >= 0; depth--) {
    const node = findNodeAtLocation(root, path.slice(0, depth));
    if (node !== undefined) {
      return { offset: node.offset, length: node.length };
    }
  }
  return { offset: 0, length: text.length };
}
