// Takus — Main Entry Point
import './styles/index.css';
import './styles/components.css';
import './styles/animations.css';
import { initConfig } from './lib/config.js';
import { StateMachine } from './lib/state-machine.js';
import { AppShell } from './components/app-shell.js';
import { toast } from './components/toast.js';
import { renderSharedView } from './components/shared-view.js';

import { installErrorBoundary } from './lib/error-boundary.js';
import { initFeedbackButton } from './components/feedback-modal.js';

// Install global error boundary — surfaces unexpected crashes as visible
// toasts since there's no server-side logging in a client-side app.
installErrorBoundary();

// Network connectivity feedback — warn before uploads would fail
window.addEventListener('offline', () => {
  toast.warning('You are offline', 'Uploads will fail until connectivity is restored.');
});
window.addEventListener('online', () => {
  toast.success('Back online', 'Network connection restored.');
});

// Render shared summary view if URL hash contains a #share= payload (Phase 7)
renderSharedView();

// Initialize
const config = initConfig();
const stateMachine = new StateMachine();
const root = document.getElementById('app');

if (!root) {
  console.error('[Takus] #app mount point not found');
} else {
  const app = new AppShell(root, stateMachine);
  app.init();
  initFeedbackButton();

  // Inject CSS animations for the pipeline progress component
  import('./components/pipeline-progress.js').then(m => m.injectPipelineStyles()).catch(() => {});

  // App Platform Bootstrap — register built-in apps and initialize the manager.
  // This runs after AppShell.init() to avoid breaking the existing render cycle.
  // Apps are activated in the background; the existing tab system continues to work.
  (async () => {
    try {
      const { registerBuiltInApps } = await import('./apps/registry.js');
      const { initAppManager } = await import('./lib/app-manager.js');
      registerBuiltInApps();
      await initAppManager();

      // Run data migration (v14 → v15) on first load after upgrade
      const { runMigrationV15 } = await import('./lib/migrations/v14-to-v15.js');
      const result = await runMigrationV15();
      if (result.migrated) {
        console.info('[Takus] Migration v15 complete:', result.stats);
      }
    } catch (err) {
      console.warn('[Takus] App platform init failed (non-fatal):', err.message);
    }

    // Initialize offline queue — ensures queued operations (uploads, etc.)
    // survive page refreshes and retry automatically when connectivity returns.
    try {
      const { initOfflineQueue, registerQueueHandler } = await import('./lib/offline-queue.js');

      registerQueueHandler('cloud-upload', async (payload) => {
        const { getEntry, getMediaBlob } = await import('./lib/storage.js');
        const { uploadToCloud } = await import('./lib/upload-manager.js');
        const entry = await getEntry(payload.contentId);
        const blob = await getMediaBlob(payload.contentId);
        if (!entry || !blob) throw new Error('Entry or blob not found for queued upload');

        // Get the active cloud provider via the manager singleton
        const { CloudProviderManager } = await import('./lib/cloud-provider.js');
        const provider = CloudProviderManager.getInstance().getProvider();
        if (!provider) throw new Error('Cloud provider not available');

        await uploadToCloud({
          blob,
          filename: payload.filename,
          entry,
          provider,
        });
      });

      await initOfflineQueue();
    } catch (err) {
      console.warn('[Takus] Offline queue init failed (non-fatal):', err.message);
    }
  })();
}

// Register service worker. Resolved relative to document.baseURI so the
// scope is correct on both Netlify (root) and GitHub Pages (sub-path).
if ('serviceWorker' in navigator) {
  // Notify when a new SW version takes control (sw.js calls skipWaiting immediately on install).
  // Track whether there was already a controller at page load so we don't toast on first install.
  let _hadController = !!navigator.serviceWorker.controller;
  let _swUpdateToasted = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!_hadController) { _hadController = true; return; } // first install — skip toast
    if (!_swUpdateToasted) {
      _swUpdateToasted = true;
      try { toast.info('Takus updated', 'A new version is active — reload when ready.'); } catch {}
    }
  });

  window.addEventListener('load', () => {
    const swUrl = new URL('./sw.js', document.baseURI).href;
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn('[Takus] ServiceWorker registration failed:', err);
    });
  });
}
