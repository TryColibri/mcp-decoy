import draft07 from 'ajv/dist/refs/json-schema-draft-07.json';
import { editor } from 'monaco-editor/editor/editor.api';
// oxlint-disable-next-line import/default -- Vite's `?worker` suffix
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import 'monaco-editor/features/register.all';
// oxlint-disable-next-line import/default -- Vite's `?worker` suffix
import JSONWorker from 'monaco-editor/language/json/json.worker?worker';
import { jsonDefaults } from 'monaco-editor/languages/features/json/register';

import {
  CALL_TOOL_RESULT_SCHEMA,
  JSON_E_URI_GLOB,
  registerJSONEOperators,
} from './json-e-language';

/** Models of this mode have a URI starting with `inmemory://decoy/json-schema/`. */
export const JSON_SCHEMA_URI_GLOB = 'json-schema/*';

/** Font of the editors, measured by Monaco once it has loaded. */
const FONT = '12.5px "Geist Mono"';

/**
 * The meta-schema documents give keyword completion and hover in the input
 * schema. Monaco's JSON language service can't follow the `$dynamicRef` of
 * the 2019-09 and 2020-12 meta-schemas, so draft-07's stands in for them as
 * well: a `$schema` naming either still resolves to something.
 */
const META_SCHEMA_URIS = [
  'http://json-schema.org/draft-07/schema',
  'https://json-schema.org/draft/2019-09/schema',
  'https://json-schema.org/draft/2020-12/schema',
];

let done = false;

/**
 * Prepares Monaco on first call: bundled workers (nothing is fetched from a
 * CDN), the JSON language service, the json-e completions, and the font
 * measurements. Later calls do nothing.
 */
export function setupMonaco(): void {
  if (done) {
    return;
  }
  done = true;

  self.MonacoEnvironment = {
    getWorker: (_id, label) =>
      label === 'json' ? new JSONWorker() : new EditorWorker(),
  };

  jsonDefaults.setDiagnosticsOptions({
    // Syntax errors only: json-e templates never match a schema, and the
    // form's own validators report the schema problems.
    validate: true,
    schemaValidation: 'ignore',
    schemaRequest: 'ignore',
    enableSchemaRequest: false,
    allowComments: false,
    schemas: [
      {
        uri: 'decoy://schemas/call-tool-result.json',
        fileMatch: [JSON_E_URI_GLOB],
        schema: CALL_TOOL_RESULT_SCHEMA,
      },
      ...META_SCHEMA_URIS.map((uri) => ({
        uri,
        fileMatch: uri === META_SCHEMA_URIS[0] ? [JSON_SCHEMA_URI_GLOB] : [],
        schema: { ...draft07, $id: uri },
      })),
    ],
  });
  registerJSONEOperators();

  // Monaco measures characters once; with the fallback font it would place
  // the cursor wrong for good.
  void document.fonts.load(FONT).then(() => {
    editor.remeasureFonts();
  });
}
