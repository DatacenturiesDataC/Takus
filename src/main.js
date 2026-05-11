// Takus — Main Entry Point
import './styles/index.css';
import './styles/components.css';
import './styles/animations.css';
import { initConfig } from './lib/config.js';
import { StateMachine } from './lib/state-machine.js';
import { AppShell } from './components/app-shell.js';
import { toast } from './components/toast.js';
import { renderSharedView } from './components/shared-view.js';

// Global error boundary — surface unexpected crashes as visible errors
// since there's no server-side logging in a client-side app.
window.addEventListener('error', (e) => {
  console.error('[Takus] Uncaught error:', e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Takus] Unhandled rejection:', e.reason);
  // Show a visible toast so the user knows something went wrong.
  // Only show if toast is initialized (avoids error during startup).
  try {
    const msg = e.reason?.message || String(e.reason || 'An unexpected error occurred');
    toast.error('Something went wrong', msg.slice(0, 200));
  } catch { /* toast may not be ready during early init */ }
});

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
