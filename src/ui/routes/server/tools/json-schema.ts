import Ajv from 'ajv';
import Ajv2019 from 'ajv/dist/2019';
import Ajv2020 from 'ajv/dist/2020';

/** Sentinel `$schema` fragments of the dialects other than the default. */
const DRAFT_07 = 'draft-07';
const DRAFT_2019_09 = '2019-09';

/**
 * Checks that a value is a valid JSON Schema, the way a client compiling it
 * would. The dialect follows `$schema` (draft-07, 2019-09 or 2020-12) and
 * defaults to 2020-12, like MCP. Unknown formats and keywords are accepted.
 *
 * @param schema - The parsed input schema.
 * @returns The error to show, or `undefined` when it is a valid JSON Schema.
 */
export function checkJSONSchema(schema: object): string | undefined {
  // A new instance per call: compiling registers `$id`s, so reusing one
  // would reject the same schema on the second check.
  const ajv = createAjv(dialectOf(schema));
  try {
    if (ajv.validateSchema(schema) !== true) {
      const first = ajv.errors?.at(0);
      const at =
        first === undefined || first.instancePath === ''
          ? ''
          : ` at ${first.instancePath}`;
      return `Not a valid JSON Schema${at}: ${first?.message ?? 'unknown error'}`;
    }
    ajv.compile(schema);
    return undefined;
  } catch (error) {
    return `Not a valid JSON Schema: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const dialectOf = (schema: object): string =>
  '$schema' in schema && typeof schema.$schema === 'string'
    ? schema.$schema
    : '';

const createAjv = (dialect: string) => {
  const options = { strict: false, logger: false } as const;
  if (dialect.includes(DRAFT_07)) {
    return new Ajv(options);
  }
  if (dialect.includes(DRAFT_2019_09)) {
    return new Ajv2019(options);
  }
  return new Ajv2020(options);
};
