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
let _outsideClickHandler = null;

function _injectStyles() {
  // Styles extracted to src/styles/floating-capture.css
  // Imported via main.js — no runtime injection needed
  return;
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

  // Close menu on outside click (store reference for cleanup in destroyFloatingCapture)
  _outsideClickHandler = () => {
    menu?.classList.remove('visible');
  };
  document.addEventListener('click', _outsideClickHandler);

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
  if (_outsideClickHandler) {
    document.removeEventListener('click', _outsideClickHandler);
    _outsideClickHandler = null;
  }
  if (_container) {
    _container.remove();
    _container = null;
  }
}
