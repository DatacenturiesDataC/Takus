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
    rollupOptions: {
      output: {
        manualChunks(id) {
          // npm dependencies → vendor chunk
          if (id.includes('node_modules')) return 'vendor';
          // Cloud provider modules → cloud chunk
          if (id.includes('google-drive') || id.includes('microsoft-onedrive') || id.includes('google-docs') || id.includes('onedrive-notes')) return 'cloud';
          // AI engine, embeddings, analytics → ai chunk
          if (id.includes('ai-engine') || id.includes('embeddings') || id.includes('analytics') || id.includes('knowledge-framework') || id.includes('autonomy-engine')) return 'ai';
          // Recording pipeline → pipeline chunk
          if (id.includes('recording-pipeline') || id.includes('recording-types') || id.includes('ffmpeg-engine') || id.includes('archive-engine')) return 'pipeline';
          // Integration modules → integrations chunk
          if (id.includes('integrations/')) return 'integrations';
          // Core data layer → core chunk
          if (id.includes('lib/storage') || id.includes('lib/graph/') || id.includes('lib/config') || id.includes('lib/settings-store') || id.includes('lib/recorder')) return 'core';
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
