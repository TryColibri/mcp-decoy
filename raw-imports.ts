import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAW_SUFFIX = '?raw';

// Dev only (`pnpm dev:server`): tsx doesn't understand the `?raw` suffix that
// Vite, Vitest and tsdown (see tsdown.config.ts) handle, so
// `import text from './file.md?raw'` becomes the file's text here too.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.endsWith(RAW_SUFFIX) || context.parentURL === undefined) {
      return nextResolve(specifier, context);
    }
    return {
      url: new URL(specifier, context.parentURL).href,
      format: 'module',
      shortCircuit: true,
    };
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(RAW_SUFFIX)) {
      return nextLoad(url, context);
    }
    const path = fileURLToPath(url.slice(0, -RAW_SUFFIX.length));
    return {
      format: 'module',
      source: `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`,
      shortCircuit: true,
    };
  },
});
