import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { defineConfig } from 'tsdown';

const RAW_SUFFIX = '?raw';
const RAW_PREFIX = '\0raw:';

/** Bundles `import text from './file.md?raw'` as a string, like Vite does. */
const rawImports = {
  name: 'raw-imports',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith(RAW_SUFFIX) || importer === undefined) {
      return null;
    }
    const path = resolve(
      dirname(importer),
      source.slice(0, -RAW_SUFFIX.length),
    );
    return `${RAW_PREFIX}${path}`;
  },
  async load(id: string) {
    if (!id.startsWith(RAW_PREFIX)) {
      return null;
    }
    const text = await readFile(id.slice(RAW_PREFIX.length), 'utf8');
    return `export default ${JSON.stringify(text)};`;
  },
};

export default defineConfig({
  entry: { cli: 'src/server/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  // `vite build` writes dist/ui first; keep it.
  clean: false,
  tsconfig: 'tsconfig.server.json',
  dts: false,
  fixedExtension: false,
  sourcemap: false,
  plugins: [rawImports],
});
