import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };
const exclude = [...configDefaults.exclude, '**/.agents/**', '**/.claude/**'];

export default defineConfig({
  resolve: { alias },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    passWithNoTests: true,
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
    },
    typecheck: {
      tsconfig: './tsconfig.json',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/server/**/*.test.ts', 'src/shared/**/*.test.ts'],
          exclude,
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/ui/**/*.test.{ts,tsx}'],
          exclude,
          setupFiles: ['./vitest.setup.ui.ts'],
        },
      },
    ],
  },
});
