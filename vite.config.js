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
    cssCodeSplit: true,
    cssMinify: 'lightningcss',
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // npm dependencies → vendor chunk
          if (id.includes('node_modules')) return 'vendor';

          // ── Cloud + Connect (merged to avoid circular: connect-panel → cloud-provider → storage → core) ──
          if (id.includes('google-drive') || id.includes('microsoft-onedrive') || id.includes('google-docs') || id.includes('onedrive-notes')) return 'cloud';
          if (id.includes('cloud-provider') || id.includes('google-auth') || id.includes('microsoft-auth') || id.includes('google-calendar') || id.includes('microsoft-calendar') || id.includes('microsoft-onenote')) return 'cloud';
          if (id.includes('connect-panel') || id.includes('identity-vault') || id.includes('integration-config')) return 'cloud';

          // ── AI engine, embeddings, analytics → ai chunk ──
          if (id.includes('ai-engine') || id.includes('embeddings') || id.includes('analytics') || id.includes('knowledge-framework') || id.includes('autonomy-engine') || id.includes('knowledge-level') || id.includes('vector-bridge') || id.includes('vector-worker')) return 'ai';

          // ── Recording pipeline → pipeline chunk ──
          if (id.includes('recording-pipeline') || id.includes('recording-types') || id.includes('ffmpeg-engine') || id.includes('archive-engine')) return 'pipeline';
          if (id.includes('content-pipeline') || id.includes('document-adapter')) return 'pipeline';

          // ── Integrations + Apps (merged to avoid circular: apps import integration modules) ──
          if (id.includes('integrations/')) return 'integrations-apps';
          if (id.includes('/apps/')) return 'integrations-apps';

          // ── Core data layer → core chunk ──
          if (id.includes('lib/storage') || id.includes('lib/graph/') || id.includes('lib/config') || id.includes('lib/recorder')) return 'core';

          // ── Tasks + Insights (merged to avoid circular: shared task-store, analytics deps) ──
          if (id.includes('insights-panel') || id.includes('insights-cards/')) return 'tasks-insights';
          if (id.includes('global-tasks-panel') || id.includes('tasks-panel')) return 'tasks-insights';
          if (id.includes('task-store') || id.includes('task-priority') || id.includes('task-helpers')) return 'tasks-insights';
          if (id.includes('daily-digest') || id.includes('blind-spot-detector') || id.includes('calendar-poller') || id.includes('edge-types') || id.includes('closeness-score') || id.includes('activity-timeline')) return 'tasks-insights';

          // ── Heavy UI panels → separate lazy chunks ──
          if (id.includes('history-panel') || id.includes('history-cards/') || id.includes('history-utils')) return 'history';
          if (id.includes('entry-detail')) return 'entry-detail';
          if (id.includes('command-bar')) return 'command-bar';
          if (id.includes('setup-wizard') || id.includes('workspace-setup')) return 'setup-wizard';
          if (id.includes('ask-panel') || id.includes('search-engine') || id.includes('chat-store')) return 'ask';

          // ── Settings (60 KB+ combined — pull out of main chunk) ──
          if (id.includes('settings-panel') || id.includes('settings-utils') || id.includes('settings-store')) return 'settings';

          // ── Capture lifecycle (controller + sub-components needed only during recording) ──
          if (id.includes('capture-controller') || id.includes('session-config') || id.includes('upload-manager') || id.includes('upload-tracker') || id.includes('upload-progress') || id.includes('share-panel') || id.includes('observer') || id.includes('offline-queue') || id.includes('content-templates') || id.includes('content-types')) return 'capture';

          // ── Home dashboard (32 KB — lazy-rendered after shell) ──
          if (id.includes('home-dashboard')) return 'home-dashboard';

          // ── Shared small libraries used everywhere ──
          if (id.includes('lib/icons') || id.includes('lib/utils') || id.includes('lib/events') || id.includes('lib/id.') || id.includes('lib/feature-flags') || id.includes('lib/state-machine')) return 'shared-lib';
          if (id.includes('dialog-utils') || id.includes('preference-engine') || id.includes('notification-manager') || id.includes('notification-prefs') || id.includes('rate-limiter') || id.includes('schema-validator')) return 'shared-lib';

          // ── Remaining lib modules not yet matched ──
          if (id.includes('feedback-engine') || id.includes('feedback-modal') || id.includes('error-boundary')) return 'feedback';
          if (id.includes('app-manager') || id.includes('app-interface') || id.includes('step-executor') || id.includes('approval-center') || id.includes('auto-runs')) return 'app-platform';
          if (id.includes('wellbeing') || id.includes('greeting-engine') || id.includes('meeting-prep') || id.includes('health-check') || id.includes('lifecycle-manager')) return 'background';
          if (id.includes('qr-code') || id.includes('workspace.js') || id.includes('library-io') || id.includes('import-engine') || id.includes('export-engine') || id.includes('zip-export') || id.includes('idb-compaction') || id.includes('document-parsers') || id.includes('inbound-adapter') || id.includes('inbound-poller') || id.includes('inbox.js')) return 'tools';

          // ── Remaining components (review, recorder-panel, preview, consent, etc.) ──
          if (id.includes('review-panel') || id.includes('recorder-panel') || id.includes('preview-canvas') || id.includes('consent-notice') || id.includes('auto-record') || id.includes('pipeline-progress') || id.includes('type-picker') || id.includes('quick-actions') || id.includes('archive-player') || id.includes('shared-view') || id.includes('watch-modal') || id.includes('workspace-panel') || id.includes('contacts-panel') || id.includes('floating-capture-bar')) return 'capture';
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
