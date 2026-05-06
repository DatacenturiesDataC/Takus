// Takus — Recorder Panel (main controls)
import { icons } from '../lib/icons.js';
import { States } from '../lib/state-machine.js';
import { formatDuration, formatSize } from '../lib/recorder.js';

export function renderRecorderPanel(container, state, { isCameraActive = false, onStart, onPause, onResume, onStop, onToggleCamera }) {
  const s = state;
  const isIdle = s === States.IDLE;
  const isRecording = s === States.RECORDING;
  const isPaused = s === States.PAUSED;
  const isPreviewing = s === States.PREVIEWING;
  const isRequesting = s === States.REQUESTING_ACCESS;

  container.innerHTML = `
    <div class="card animate-in" style="text-align:center;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-6);">

        ${(isRecording || isPaused) ? `
          <div id="rec-stats" class="stat-grid w-full" style="text-align:left;">
            <div class="stat">
              <span class="stat-value" id="stat-duration" style="color:${isRecording ? 'var(--color-recording)' : 'var(--color-warning)'}">00:00:00</span>
              <span class="stat-label">${isPaused ? 'Paused' : 'Duration'}</span>
            </div>
            <div class="stat">
              <span class="stat-value" id="stat-size">0 B</span>
              <span class="stat-label">File Size</span>
            </div>
          </div>
        ` : ''}

        <div style="display:flex;align-items:center;gap:var(--space-4);">
          ${isIdle ? `
            <button class="btn btn-ghost btn-icon ${isCameraActive ? 'text-primary' : ''}" id="btn-camera" title="Toggle Facecam (PiP)" aria-label="Toggle webcam">
              ${isCameraActive ? icons.video(18) : icons.videoOff(18)}
            </button>
            <button class="record-btn" id="btn-start" title="Start Recording (R)" aria-label="Start recording">
              <div class="record-icon"></div>
            </button>
          ` : ''}

          ${isRequesting ? `
            <div style="display:flex;align-items:center;gap:var(--space-3);">
              <div class="spinner"></div>
              <span style="color:var(--color-text-secondary);font-size:var(--font-sm);">Requesting screen access…</span>
            </div>
          ` : ''}

          ${isPreviewing ? `
            <button class="btn btn-success btn-lg" id="btn-confirm">${icons.video(18)} Start Recording</button>
            <button class="btn btn-ghost" id="btn-cancel">${icons.x(16)} Cancel</button>
          ` : ''}

          ${isRecording ? `
            <button class="btn btn-ghost btn-icon" id="btn-pause" title="Pause (Space)" aria-label="Pause recording">${icons.pause(18)}</button>
            <button class="record-btn recording" id="btn-stop" title="Stop (S)" aria-label="Stop recording">
              <div class="record-icon"></div>
            </button>
          ` : ''}

          ${isPaused ? `
            <button class="btn btn-success btn-icon" id="btn-resume" title="Resume (Space)" aria-label="Resume recording">${icons.play(18)}</button>
            <button class="record-btn" id="btn-stop" title="Stop (S)" aria-label="Stop recording">
              <div class="record-icon"></div>
            </button>
          ` : ''}
        </div>

        ${isIdle ? `
          <p style="font-size:var(--font-sm);color:var(--color-text-muted);">Click to record your screen · Press <kbd style="background:var(--color-bg-elevated);padding:2px 6px;border-radius:4px;font-size:var(--font-xs);">R</kbd> to start</p>
        ` : ''}
      </div>
    </div>
  `;

  // Bind events
  container.querySelector('#btn-start')?.addEventListener('click', onStart);
  container.querySelector('#btn-camera')?.addEventListener('click', onToggleCamera);
  container.querySelector('#btn-confirm')?.addEventListener('click', onStart);
  container.querySelector('#btn-cancel')?.addEventListener('click', onStop);
  container.querySelector('#btn-pause')?.addEventListener('click', onPause);
  container.querySelector('#btn-resume')?.addEventListener('click', onResume);
  container.querySelector('#btn-stop')?.addEventListener('click', onStop);
}

export function updateRecorderStats(elapsed, totalSize) {
  const dur = document.getElementById('stat-duration');
  const size = document.getElementById('stat-size');
  if (dur) dur.textContent = formatDuration(elapsed);
  if (size) size.textContent = formatSize(totalSize);
}
