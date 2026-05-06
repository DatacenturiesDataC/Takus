// Takus — Main Entry Point
import './styles/index.css';
import './styles/components.css';
import './styles/animations.css';
import { initConfig } from './lib/config.js';
import { StateMachine } from './lib/state-machine.js';
import { AppShell } from './components/app-shell.js';

// Global error boundary — surface unexpected crashes as visible errors
// since there's no server-side logging in a client-side app.
window.addEventListener('error', (e) => {
  console.error('[Takus] Uncaught error:', e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Takus] Unhandled rejection:', e.reason);
});

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
