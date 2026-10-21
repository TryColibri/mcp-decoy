import { defineConfig } from 'tsdown';

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
});
