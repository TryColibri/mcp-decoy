import { type Node, parseTree } from 'jsonc-parser';

/** What a highlighted span of a json-e template is. */
export type JSONEHighlightKind = 'operator' | 'interpolation';

/** A span of a json-e template to color. */
export type JSONEHighlight = {
  /** An operator key such as `"$if"`, or a `${…}` interpolation. */
  kind: JSONEHighlightKind;
  /** Offset of the first character. */
  offset: number;
  /** Number of characters. */
  length: number;
};

/**
 * Finds the json-e syntax in a template: operator keys (`"$eval"`, `"$if"`, …)
 * and `${…}` interpolations in string values. The escapes `$$` (a literal
 * `$` in a key) and `$${` (a literal `${`) are not syntax.
 *
 * The text may be incomplete or invalid; whatever parses is highlighted.
 *
 * @param text - The template as JSON text.
 * @returns The spans, in document order.
 */
export function findJSONEHighlights(text: string): JSONEHighlight[] {
  const root = parseTree(text, [], { allowTrailingComma: true });
  const found: JSONEHighlight[] = [];
  if (root !== undefined) {
    collect(text, root, found);
  }
  return found;
}

const collect = (text: string, node: Node, found: JSONEHighlight[]): void => {
  if (node.type === 'property') {
    const key = node.children?.at(0);
    const value = node.children?.at(1);
    if (key !== undefined && isOperatorKey(key)) {
      found.push({ kind: 'operator', offset: key.offset, length: key.length });
    }
    if (value !== undefined) {
      collect(text, value, found);
    }
    return;
  }
  if (node.type === 'string') {
    found.push(...interpolationsOf(text, node));
    return;
  }
  for (const child of node.children ?? []) {
    collect(text, child, found);
  }
};

const isOperatorKey = (key: Node): boolean =>
  typeof key.value === 'string' &&
  key.value.length > 1 &&
  key.value.startsWith('$') &&
  !key.value.startsWith('$$');

const interpolationsOf = (text: string, node: Node): JSONEHighlight[] => {
  // The raw source between the quotes: escapes such as \" are still in it.
  const start = node.offset + 1;
  const raw = text.slice(start, node.offset + node.length - 1);
  const found: JSONEHighlight[] = [];
  let index = 0;
  while (index < raw.length) {
    if (raw.startsWith('$${', index)) {
      index += 3;
    } else if (raw.startsWith('${', index)) {
      const end = closingBrace(raw, index + 2);
      found.push({
        kind: 'interpolation',
        offset: start + index,
        length: end - index,
      });
      index = end;
    } else {
      index++;
    }
  }
  return found;
};

/** Index just after the `}` closing an interpolation, or the end if unclosed. */
const closingBrace = (raw: string, from: number): number => {
  let depth = 1;
  let index = from;
  while (index < raw.length) {
    const character = raw[index];
    if (character === "'") {
      const close = raw.indexOf("'", index + 1);
      index = close === -1 ? raw.length : close + 1;
      continue;
    }
    if (character === '{') {
      depth++;
    } else if (character === '}' && --depth === 0) {
      return index + 1;
    }
    index++;
  }
  return raw.length;
};
