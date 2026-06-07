// Takus — Main Entry Point
import './styles/tokens.css';
import './styles/index.css';
import './styles/chat.css';
import './styles/history.css';
import './styles/markdown.css';
import './styles/insights.css';
import './styles/settings-panel.css';
import './styles/wizard.css';
import './styles/workspace.css';
import './styles/components.css';
import './styles/tasks.css';
import './styles/entry-detail.css';
import './styles/controls.css';
import './styles/animations.css';
import './styles/dashboard.css';
import './styles/sidebar.css';
import './styles/floating-capture.css';
import './styles/mobile.css';
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

// Core Web Vitals — passive performance measurement (non-blocking)
import { initWebVitals } from './lib/web-vitals.js';
initWebVitals((metric) => {
  if (metric.rating !== 'good') {
    console.info(`[Vitals] ${metric.name}: ${Math.round(metric.value)}ms (${metric.rating})`);
  }
});

// Render shared summary view if URL hash contains a #share= payload
renderSharedView();

// Initialize
initConfig();

// ── IDB Health Check ──────────────────────────────────────────────────────
// Verify IndexedDB is available before booting. In Safari private browsing
// or restrictive environments, IDB may be blocked — recording would silently
// fail because entries can't be saved. Better to tell the user immediately.
try {
  const _idbTest = indexedDB.open('_takus_health_check');
  _idbTest.onerror = () => {
    _showIDBUnavailable();
  };
  _idbTest.onsuccess = () => {
    _idbTest.result.close();
    try { indexedDB.deleteDatabase('_takus_health_check'); } catch { /* best-effort cleanup */ }
  };
} catch {
  _showIDBUnavailable();
}

function _showIDBUnavailable() {
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:var(--space-6);text-align:center;">
      <div style="max-width:420px;">
        <div style="font-size:3rem;margin-bottom:var(--space-4);">🔒</div>
        <h1 style="font-size:var(--text-xl);margin-bottom:var(--space-3);">Storage Unavailable</h1>
        <p style="color:var(--text-secondary);margin-bottom:var(--space-4);line-height:1.6;">
          Takus requires persistent storage to save your recordings and data.
          This is usually caused by <strong>private browsing mode</strong> or restrictive browser settings.
        </p>
        <p style="color:var(--text-muted);font-size:var(--text-sm);">
          Please exit private browsing, or enable cookies and site data for this site.
        </p>
      </div>
    </div>
  `;
  // Prevent further boot
  throw new Error('[Takus] IndexedDB unavailable — boot aborted');
}

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
      try { toast.info('Takus updated', 'A new version is active — reload when ready.'); } catch { /* non-critical */ }
    }
  });

  window.addEventListener('load', () => {
    const swUrl = new URL('./sw.js', document.baseURI).href;
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn('[Takus] ServiceWorker registration failed:', err);
    });
  });
}
