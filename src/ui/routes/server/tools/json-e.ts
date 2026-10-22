import jsone from 'json-e';

/** Names of the json-e errors that don't depend on the call's arguments. */
const STRUCTURAL_ERRORS = new Set(['SyntaxError', 'TemplateError']);

/**
 * Renders a template in the browser with empty `args` and reports only the
 * errors that no arguments can fix: a misused operator, a malformed
 * expression. Errors that depend on `args`, such as a missing property, are
 * ignored, and so is whatever json-e doesn't reach after the first of them.
 *
 * @param template - A parsed JSON value; keys starting with `$` are operators.
 * @returns The error to show, or `undefined` when none was found.
 */
export function checkTemplateStructure(template: unknown): string | undefined {
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
        ? ` at template${error.location.join('')}`
        : '';
    return `${error.name}${location}: ${error.message}`;
  }
}
