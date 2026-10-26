import { getLocation } from 'jsonc-parser';
import {
  type editor,
  type IDisposable,
  languages,
  type Position,
  Range,
} from 'monaco-editor/editor/editor.api';
import { type JSONSchema } from 'monaco-editor/languages/features/json/register';

/** Models of this mode have a URI starting with `inmemory://decoy/json-e/`. */
export const JSON_E_URI_GLOB = 'json-e/*';

type Operator = {
  /** The operator key, `$` included. */
  name: string;
  /** What it does, shown next to the suggestion. */
  documentation: string;
  /** Snippet inserted in place of the key typed so far; `$` is escaped. */
  snippet: string;
};

const OPERATORS: Operator[] = [
  {
    name: '$eval',
    documentation: 'Evaluates an expression and inserts its value.',
    snippet: '"\\$eval": "${1:args}"',
  },
  {
    name: '$json',
    documentation: 'Renders the value, then serializes it to a JSON string.',
    snippet: '"\\$json": ${1:{\\}}',
  },
  {
    name: '$if',
    documentation:
      'Renders `then` when the expression is truthy, `else` otherwise.',
    snippet:
      '"\\$if": "${1:args.flag}",\n"then": ${2:null},\n"else": ${3:null}',
  },
  {
    name: '$switch',
    documentation:
      'Renders the value of the first key whose expression is truthy.',
    snippet:
      '"\\$switch": {\n\t"${1:args.n == 1}": ${2:null},\n\t"\\$default": ${3:null}\n}',
  },
  {
    name: '$match',
    documentation: 'Like `$switch`, but every matching key is rendered.',
    snippet: '"\\$match": {\n\t"${1:args.n == 1}": ${2:null}\n}',
  },
  {
    name: '$map',
    documentation: 'Renders `each(x)` for every item of an array or object.',
    snippet: '"\\$map": "${1:args.items}",\n"each(${2:x})": ${3:null}',
  },
  {
    name: '$reduce',
    documentation: 'Folds an array into one value, starting at `initial`.',
    snippet:
      '"\\$reduce": "${1:args.items}",\n"initial": ${2:0},\n"each(${3:acc}, ${4:x})": ${5:null}',
  },
  {
    name: '$find',
    documentation: 'Finds the first item for which `each(x)` is truthy.',
    snippet: '"\\$find": "${1:args.items}",\n"each(${2:x})": "${3:true}"',
  },
  {
    name: '$let',
    documentation: 'Binds variables, then renders `in` with them.',
    snippet: '"\\$let": {\n\t"${1:name}": ${2:null}\n},\n"in": ${3:null}',
  },
  {
    name: '$flatten',
    documentation: 'Flattens an array of arrays by one level.',
    snippet: '"\\$flatten": ${1:[]}',
  },
  {
    name: '$flattenDeep',
    documentation: 'Flattens nested arrays at every depth.',
    snippet: '"\\$flattenDeep": ${1:[]}',
  },
  {
    name: '$merge',
    documentation: 'Merges an array of objects, later keys winning.',
    snippet: '"\\$merge": ${1:[]}',
  },
  {
    name: '$mergeDeep',
    documentation: 'Merges an array of objects recursively.',
    snippet: '"\\$mergeDeep": ${1:[]}',
  },
  {
    name: '$sort',
    documentation: 'Sorts an array; `by(x)` picks the sort key.',
    snippet: '"\\$sort": ${1:[]}',
  },
  {
    name: '$reverse',
    documentation: 'Reverses an array.',
    snippet: '"\\$reverse": ${1:[]}',
  },
  {
    name: '$fromNow',
    documentation: 'The current time plus a duration such as `2 hours`.',
    snippet: '"\\$fromNow": "${1:1 day}"',
  },
];

/** Where in a line the string being completed starts and ends. */
type StringSpan = { start: number; end: number };

/** Characters of an unfinished key, after its opening quote. */
const KEY_CHARACTER = /[\w$]/;

const stringAround = (line: string, column: number): StringSpan | undefined => {
  const quote = line.lastIndexOf('"', column - 2);
  if (quote === -1 || line.slice(quote + 1, column - 1).includes('"')) {
    return undefined;
  }
  let end = column - 1;
  while (end < line.length && KEY_CHARACTER.test(line.charAt(end))) {
    end++;
  }
  return { start: quote, end: line.charAt(end) === '"' ? end + 1 : end };
};

const suggestOperators = (
  model: editor.ITextModel,
  position: Position,
): languages.CompletionList => {
  const location = getLocation(model.getValue(), model.getOffsetAt(position));
  const span = stringAround(
    model.getLineContent(position.lineNumber),
    position.column,
  );
  if (!location.isAtPropertyKey || span === undefined) {
    return { suggestions: [] };
  }
  const range = new Range(
    position.lineNumber,
    span.start + 1,
    position.lineNumber,
    span.end + 1,
  );
  return {
    suggestions: OPERATORS.map(({ name, documentation, snippet }) => ({
      label: name,
      kind: languages.CompletionItemKind.Keyword,
      documentation,
      insertText: snippet,
      insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet,
      filterText: `"${name}"`,
      // After the keys of the schema: `$` would otherwise sort first.
      sortText: `~${name}`,
      range,
    })),
  };
};

/**
 * Suggests the json-e operators as snippets for the keys of json-e models.
 *
 * @returns A handle to unregister the provider.
 */
export function registerJSONEOperators(): IDisposable {
  return languages.registerCompletionItemProvider('json', {
    triggerCharacters: ['"', '$'],
    provideCompletionItems: (model, position) =>
      model.uri.path.startsWith('/json-e/')
        ? suggestOperators(model, position)
        : { suggestions: [] },
  });
}

const optional = (description: string): JSONSchema => ({
  type: 'string',
  description,
});

const annotations: JSONSchema = {
  type: 'object',
  description: 'Optional hints for the client about the content.',
  properties: {
    audience: {
      type: 'array',
      items: { enum: ['user', 'assistant'] },
      description: 'Who the content is meant for.',
    },
    priority: {
      type: 'number',
      description: 'How important the content is, from 0 to 1.',
    },
    lastModified: optional('ISO 8601 time the content last changed.'),
  },
};

const meta: JSONSchema = {
  type: 'object',
  description: 'Free-form metadata, reserved for protocol extensions.',
};

const contentItem = (
  type: string,
  description: string,
  properties: Record<string, JSONSchema>,
): JSONSchema => ({
  type: 'object',
  description,
  properties: {
    type: { const: type, description: `Always "${type}".` },
    ...properties,
    annotations,
    _meta: meta,
  },
  required: ['type', ...Object.keys(properties)],
});

/**
 * A hand-written JSON Schema of the MCP `CallToolResult`: just enough for
 * keyword completion and hover in the response template. It is not used to
 * validate: a json-e template is not a result until it is rendered.
 */
export const CALL_TOOL_RESULT_SCHEMA: JSONSchema = {
  type: 'object',
  description: 'The result a client receives when it calls the tool.',
  properties: {
    content: {
      type: 'array',
      description: 'What the tool returned, as a list of content blocks.',
      items: {
        anyOf: [
          contentItem('text', 'Plain text.', {
            text: { type: 'string', description: 'The text.' },
          }),
          contentItem('image', 'An image.', {
            data: optional('Base64-encoded image data.'),
            mimeType: optional('MIME type, such as image/png.'),
          }),
          contentItem('audio', 'Audio.', {
            data: optional('Base64-encoded audio data.'),
            mimeType: optional('MIME type, such as audio/wav.'),
          }),
          contentItem('resource_link', 'A link to a resource.', {
            uri: optional('URI of the resource.'),
            name: optional('Name of the resource.'),
            title: optional('Human-readable title.'),
            description: optional('What the resource is.'),
            mimeType: optional('MIME type of the resource.'),
          }),
          contentItem('resource', 'A resource embedded in the result.', {
            resource: {
              type: 'object',
              description: 'The embedded resource.',
              properties: {
                uri: optional('URI of the resource.'),
                mimeType: optional('MIME type of the resource.'),
                text: optional('Text content, for text resources.'),
                blob: optional('Base64 content, for binary resources.'),
              },
            },
          }),
        ],
      },
    },
    structuredContent: {
      type: 'object',
      description:
        'Structured result. Should match the output schema when there is one.',
    },
    isError: {
      type: 'boolean',
      description: 'Whether the call failed. The content then says why.',
    },
    _meta: meta,
  },
};
