// Takus — Floating Capture Bar
// A persistent, unobtrusive floating control for starting recordings.
// Replaces the large centered "Start Recording" button.
// Position: fixed bottom-right corner.

import { icons } from '../lib/icons.js';

let _stylesInjected = false;
let _container = null;
let _state = 'idle'; // idle | expanded | recording | paused
let _recordingTimer = null;
let _seconds = 0;
let _callbacks = {};

function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'floating-capture-styles';
  style.textContent = `
    .floating-capture {
      position: fixed;
      bottom: var(--space-6, 24px);
      right: var(--space-6, 24px);
      z-index: var(--z-floating, 400);
      display: flex;
      align-items: center;
      gap: var(--space-2, 8px);
      transition: all var(--transition-slow, 250ms ease);
    }

    /* Idle — single circle button */
    .fc-trigger {
      width: 48px;
      height: 48px;
      border-radius: var(--radius-full, 9999px);
      background: var(--accent-primary, #7c3aed);
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow-lg);
      transition: all var(--transition-base, 150ms ease);
      position: relative;
    }
    .fc-trigger:hover {
      background: var(--accent-hover, #6d28d9);
      transform: scale(1.08);
      box-shadow: var(--shadow-xl);
    }
    .fc-trigger:active {
      transform: scale(0.96);
    }
    .fc-trigger .fc-pulse {
      position: absolute;
      inset: -3px;
      border-radius: inherit;
      border: 2px solid var(--accent-primary, #7c3aed);
      opacity: 0;
      animation: fcPulse 2s ease-in-out infinite;
    }
    @keyframes fcPulse {
      0%, 100% { opacity: 0; transform: scale(1); }
      50% { opacity: 0.3; transform: scale(1.1); }
    }

    /* Expanded — capture type selection */
    .fc-menu {
      display: none;
      flex-direction: column;
      gap: var(--space-1, 4px);
      background: var(--bg-elevated, #222233);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg, 12px);
      padding: var(--space-2, 8px);
      box-shadow: var(--shadow-xl);
      position: absolute;
      bottom: calc(100% + var(--space-2, 8px));
      right: 0;
      min-width: 180px;
      animation: fcMenuIn 150ms ease;
    }
    .fc-menu.visible {
      display: flex;
    }
    @keyframes fcMenuIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .fc-menu-item {
      display: flex;
      align-items: center;
      gap: var(--space-3, 12px);
      padding: var(--space-2, 8px) var(--space-3, 12px);
      border-radius: var(--radius-sm, 6px);
      border: none;
      background: transparent;
      color: var(--text-primary);
      font-size: var(--text-sm, 13px);
      font-weight: var(--weight-medium, 500);
      cursor: pointer;
      transition: background var(--transition-fast, 100ms ease);
      text-align: left;
      width: 100%;
    }
    .fc-menu-item:hover {
      background: var(--bg-hover);
    }
    .fc-menu-item .fc-menu-icon {
      width: 28px;
      height: 28px;
      border-radius: var(--radius-sm, 6px);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .fc-menu-item .fc-menu-desc {
      font-size: var(--text-2xs, 11px);
      color: var(--text-muted);
      font-weight: var(--weight-normal, 400);
    }

    /* Recording state — expanded bar */
    .fc-recording-bar {
      display: none;
      align-items: center;
      gap: var(--space-3, 12px);
      padding: var(--space-2, 8px) var(--space-4, 16px);
      background: var(--bg-elevated, #222233);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-full, 9999px);
      box-shadow: var(--shadow-xl);
      animation: fcBarIn 200ms ease;
    }
    .fc-recording-bar.visible {
      display: flex;
    }
    @keyframes fcBarIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
    .fc-rec-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--color-danger, #ef4444);
      flex-shrink: 0;
      animation: fcRecBlink 1s step-end infinite;
    }
    .fc-rec-dot.paused {
      animation: none;
      background: var(--color-warning, #f59e0b);
    }
    @keyframes fcRecBlink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .fc-timer {
      font-size: var(--text-sm, 13px);
      font-weight: var(--weight-semibold, 600);
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
      min-width: 48px;
    }
    .fc-rec-btn {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-full, 9999px);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-fast, 100ms ease);
    }
    .fc-rec-btn:hover {
      transform: scale(1.1);
    }
    .fc-btn-pause {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .fc-btn-stop {
      background: var(--color-danger, #ef4444);
      color: white;
    }

    /* Hide on mobile when bottom nav is visible */
    @media (max-width: 768px) {
      .floating-capture {
        bottom: calc(var(--bottom-nav-height, 56px) + var(--space-4, 16px));
        right: var(--space-4, 16px);
      }
    }
  `;
  document.head.appendChild(style);
}

function _formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Initialize the floating capture bar.
 * @param {object} callbacks - { onStartCapture(type), onPause, onResume, onStop }
 */
export function initFloatingCapture(callbacks = {}) {
  _injectStyles();
  _callbacks = callbacks;

  if (_container) _container.remove();

  _container = document.createElement('div');
  _container.className = 'floating-capture';
  _container.id = 'floating-capture';
  _container.innerHTML = `
    <!-- Idle trigger -->
    <button class="fc-trigger" id="fc-trigger" aria-label="Start capture" title="Start capture">
      ${icons.video(20)}
      <span class="fc-pulse"></span>
    </button>

    <!-- Capture type menu -->
    <div class="fc-menu" id="fc-menu" role="menu">
      <button class="fc-menu-item" data-type="meeting" role="menuitem">
        <span class="fc-menu-icon" style="background:var(--accent-bg);color:var(--accent-primary);">${icons.users(16)}</span>
        <span>
          Meeting
          <span class="fc-menu-desc">Record a meeting with AI notes</span>
        </span>
      </button>
      <button class="fc-menu-item" data-type="screen" role="menuitem">
        <span class="fc-menu-icon" style="background:var(--color-info-bg);color:var(--color-info);">${icons.monitor(16)}</span>
        <span>
          Screen
          <span class="fc-menu-desc">Capture your screen activity</span>
        </span>
      </button>
      <button class="fc-menu-item" data-type="voice_note" role="menuitem">
        <span class="fc-menu-icon" style="background:var(--color-success-bg);color:var(--color-success);">${icons.mic(16)}</span>
        <span>
          Voice Note
          <span class="fc-menu-desc">Quick audio recording</span>
        </span>
      </button>
      <button class="fc-menu-item" data-type="presentation" role="menuitem">
        <span class="fc-menu-icon" style="background:var(--color-warning-bg);color:var(--color-warning);">${icons.play(16)}</span>
        <span>
          Presentation
          <span class="fc-menu-desc">Record with structured AI outline</span>
        </span>
      </button>
    </div>

    <!-- Recording bar -->
    <div class="fc-recording-bar" id="fc-recording-bar">
      <span class="fc-rec-dot" id="fc-rec-dot"></span>
      <span class="fc-timer" id="fc-timer">00:00</span>
      <button class="fc-rec-btn fc-btn-pause" id="fc-pause" aria-label="Pause" title="Pause">
        ${icons.pause(14)}
      </button>
      <button class="fc-rec-btn fc-btn-stop" id="fc-stop" aria-label="Stop" title="Stop recording">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor"/></svg>
      </button>
    </div>
  `;

  document.body.appendChild(_container);
  _bindEvents();
  _setState('idle');
}

function _bindEvents() {
  if (!_container) return;

  // Toggle menu
  const trigger = _container.querySelector('#fc-trigger');
  const menu = _container.querySelector('#fc-menu');

  trigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_state === 'idle') {
      menu?.classList.toggle('visible');
    }
  });

  // Close menu on outside click
  document.addEventListener('click', () => {
    menu?.classList.remove('visible');
  });

  // Capture type selection
  _container.querySelectorAll('.fc-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      menu?.classList.remove('visible');
      const type = item.dataset.type;
      if (_callbacks.onStartCapture) _callbacks.onStartCapture(type);
    });
  });

  // Pause/Resume
  _container.querySelector('#fc-pause')?.addEventListener('click', () => {
    if (_state === 'recording') {
      _setState('paused');
      if (_callbacks.onPause) _callbacks.onPause();
    } else if (_state === 'paused') {
      _setState('recording');
      if (_callbacks.onResume) _callbacks.onResume();
    }
  });

  // Stop
  _container.querySelector('#fc-stop')?.addEventListener('click', () => {
    _setState('idle');
    if (_callbacks.onStop) _callbacks.onStop();
  });
}

function _setState(state) {
  _state = state;
  if (!_container) return;

  const trigger = _container.querySelector('#fc-trigger');
  const menu = _container.querySelector('#fc-menu');
  const recordingBar = _container.querySelector('#fc-recording-bar');
  const dot = _container.querySelector('#fc-rec-dot');
  const pauseBtn = _container.querySelector('#fc-pause');

  // Reset visibility
  if (trigger) trigger.style.display = 'none';
  if (menu) menu.classList.remove('visible');
  if (recordingBar) recordingBar.classList.remove('visible');

  switch (state) {
    case 'idle':
      if (trigger) trigger.style.display = 'flex';
      clearInterval(_recordingTimer);
      _seconds = 0;
      break;
    case 'recording':
      if (recordingBar) recordingBar.classList.add('visible');
      if (dot) dot.classList.remove('paused');
      if (pauseBtn) {
        pauseBtn.innerHTML = icons.pause(14);
        pauseBtn.title = 'Pause';
        pauseBtn.setAttribute('aria-label', 'Pause');
      }
      _startTimer();
      break;
    case 'paused':
      if (recordingBar) recordingBar.classList.add('visible');
      if (dot) dot.classList.add('paused');
      if (pauseBtn) {
        pauseBtn.innerHTML = icons.play(14);
        pauseBtn.title = 'Resume';
        pauseBtn.setAttribute('aria-label', 'Resume');
      }
      clearInterval(_recordingTimer);
      break;
  }
}

function _startTimer() {
  clearInterval(_recordingTimer);
  _recordingTimer = setInterval(() => {
    _seconds++;
    const timerEl = _container?.querySelector('#fc-timer');
    if (timerEl) timerEl.textContent = _formatTime(_seconds);
  }, 1000);
}

/**
 * Notify the floating bar that recording has started (called by capture-controller).
 * @param {number} [startSeconds=0] - resume from a specific second count
 */
export function floatingCaptureStarted(startSeconds = 0) {
  _seconds = startSeconds;
  _setState('recording');
}

/**
 * Notify the floating bar that recording has stopped.
 */
export function floatingCaptureStopped() {
  _setState('idle');
}

/**
 * Notify the floating bar that recording is paused.
 */
export function floatingCapturePaused() {
  _setState('paused');
}

/**
 * Update the timer from an external source (e.g., capture-controller).
 */
export function floatingCaptureUpdateTime(seconds) {
  _seconds = seconds;
  const timerEl = _container?.querySelector('#fc-timer');
  if (timerEl) timerEl.textContent = _formatTime(_seconds);
}

/**
 * Remove the floating capture bar.
 */
export function destroyFloatingCapture() {
  clearInterval(_recordingTimer);
  if (_container) {
    _container.remove();
    _container = null;
  }
}
