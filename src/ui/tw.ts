/**
 * Tags a template literal as Tailwind class names. It interpolates like an
 * untagged template; the tag only tells the tooling (oxfmt class sorting,
 * oxlint's better-tailwindcss rules, Tailwind IntelliSense) to treat the
 * contents as classes.
 *
 * @example
 * const field = tw`rounded-lg border px-3`;
 * const input = tw`${field} min-h-10 w-full`;
 *
 * @param strings - Literal parts of the template.
 * @param values - Interpolated class names.
 */
export function tw(
  strings: TemplateStringsArray,
  ...values: readonly string[]
): string {
  return strings.reduce(
    (result, part, index) => result + values[index - 1] + part,
  );
}
