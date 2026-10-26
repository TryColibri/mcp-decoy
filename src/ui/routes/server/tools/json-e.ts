import jsone from 'json-e';
import { type JSONPath } from 'jsonc-parser';

import { type CodeEditorIssue } from '@/ui/components/code-editor';

/** Names of the json-e errors that don't depend on the call's arguments. */
const STRUCTURAL_ERRORS = new Set(['SyntaxError', 'TemplateError']);

/**
 * Renders a template in the browser with empty `args` and reports only the
 * errors that no arguments can fix: a misused operator, a malformed
 * expression. Errors that depend on `args`, such as a missing property, are
 * ignored, and so is whatever json-e doesn't reach after the first of them.
 *
 * @param template - A parsed JSON value; keys starting with `$` are operators.
 * @returns The error to show and the path of the node it is about, or
 * `undefined` when none was found.
 */
export function checkTemplateStructure(
  template: unknown,
): CodeEditorIssue | undefined {
  // json-e only accepts objects, arrays and strings at the root.
  if (
    !(typeof template === 'object' && template !== null) &&
    typeof template !== 'string'
  ) {
    return undefined;
  }
  try {
    jsone(template, { args: {} });
    return undefined;
  } catch (error) {
    if (!(error instanceof Error) || !STRUCTURAL_ERRORS.has(error.name)) {
      return undefined;
    }
    const location =
      'location' in error && Array.isArray(error.location)
        ? error.location.map(String)
        : [];
    const at = location.length === 0 ? '' : ` at template${location.join('')}`;
    return {
      message: `${error.name}${at}: ${error.message}`,
      path: pathOf(location),
    };
  }
}

/**
 * Turns json-e's error location, a list such as `['.content', '[0]',
 * '["a b"]']`, into a JSON path.
 */
const pathOf = (location: string[]): JSONPath =>
  location.map((part) => {
    if (part.startsWith('.')) {
      return part.slice(1);
    }
    const inside = part.slice(1, -1);
    return inside.startsWith('"') ? parseString(inside) : Number(inside);
  });

const parseString = (quoted: string): string => {
  const parsed: unknown = JSON.parse(quoted);
  return typeof parsed === 'string' ? parsed : quoted;
};
