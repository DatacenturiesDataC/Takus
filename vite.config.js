import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Replaces the hardcoded cache name in sw.js with a build-time token so
 * every production build automatically invalidates old service-worker caches
 * without requiring a manual version bump.
 */
function swVersionPlugin() {
  return {
    name: 'sw-version',
    closeBundle() {
      const swPath = resolve(__dirname, 'dist/sw.js');
      try {
        const token = Date.now().toString(36);
        const content = readFileSync(swPath, 'utf-8');
        writeFileSync(swPath, content.replace(/takus-cache-[^\s'";]+/, `takus-cache-${token}`));
      } catch {
        // sw.js may not exist in dev mode; safe to ignore.
      }
    },
  };
}

export default defineConfig({
  root: '.',
  base: './',
  plugins: [swVersionPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    port: 3000,
    open: true,
  },
});
