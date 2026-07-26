import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './src/manifest.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Bug B fix: Disable modulepreload polyfill — it references `document`
    // which doesn't exist in MV3 service workers, causing a ReferenceError
    // that silently kills IR Bridge and Repository V2 persistence.
    modulePreload: false,
    rollupOptions: {
      input: {
        repository: resolve(__dirname, 'src/repository/index.html'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/legacy/**'],
  },
});
