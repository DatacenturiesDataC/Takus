// Takus — Recorder Panel (main controls)
// Camera button moved to session-config; Upload button added.
import { icons } from '../lib/icons.js';
import { States } from '../lib/state-machine.js';
import { formatDuration, formatSize } from '../lib/recorder.js';
import { isScreenCaptureSupported } from '../lib/utils.js';
import { typeLabel, typeAccent } from '../lib/content-types.js';

export function renderRecorderPanel(container, state, { isCameraActive = false, contentType = null, onStart, onPause, onResume, onStop, onToggleCamera, onScreenshot, onUpload, shortcuts = {} }) {
  const s = state;
  const isIdle = s === States.IDLE;
  const isRecording = s === States.RECORDING;
  const isPaused = s === States.PAUSED;
  const isPreviewing = s === States.PREVIEWING;
  const isRequesting = s === States.REQUESTING_ACCESS;
  const canRecord = isScreenCaptureSupported();

  container.innerHTML = `
    <div class="card animate-in text-center" >
      <div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-6);">

        ${(isRecording || isPaused) ? `
          <div id="rec-stats" class="stat-grid w-full" style="text-align:left;">
            <div class="stat">
              <span class="stat-value" id="stat-duration" style="color:${isRecording ? 'var(--color-recording)' : 'var(--color-warning)'}">${formatDuration(0)}</span>
              <span class="stat-label">${isPaused ? 'Paused' : 'Duration'}</span>
            </div>
            <div class="stat">
              <span class="stat-value" id="stat-size">0 B</span>
              <span class="stat-label">File Size</span>
            </div>
            ${contentType ? `
            <div class="stat text-right" >
              <span class="stat-value" style="font-size:var(--font-xs);color:${typeAccent(contentType)};">${typeLabel(contentType)}</span>
              <span class="stat-label">Type</span>
            </div>
            ` : ''}
          </div>
        ` : ''}

        <div style="display:flex;align-items:center;gap:var(--space-4);">
          ${isIdle ? `
            ${canRecord ? `
              <button class="btn btn-ghost btn-sm flex-center" id="btn-upload" title="Upload existing recording" aria-label="Upload recording" >
                ${icons.upload(16)}
                <span class="text-xs">Upload</span>
              </button>
              <button class="record-btn" id="btn-start" title="Start Recording (${shortcuts.record === ' ' ? 'Space' : (shortcuts.record || 'R').toUpperCase()})" aria-label="Start recording">
                <div class="record-icon"></div>
              </button>
            ` : `
              <button class="record-btn disabled-look" disabled title="Screen recording requires a desktop browser" aria-label="Screen recording not supported" >
                <div class="record-icon"></div>
              </button>
            `}
          ` : ''}

          ${isRequesting ? `
            <div class="flex-center gap-3">
              <div class="spinner"></div>
              <span style="color:var(--color-text-secondary);font-size:var(--font-sm);">Requesting screen access…</span>
            </div>
          ` : ''}

          ${isPreviewing ? `
            <button class="btn btn-success btn-lg" id="btn-confirm">
              ${icons.video(18)} Start ${contentType ? typeLabel(contentType) : 'Recording'}
            </button>
            <button class="btn btn-ghost" id="btn-cancel">${icons.x(16)} Cancel</button>
          ` : ''}

          ${isRecording ? `
            <button class="btn btn-ghost btn-icon" id="btn-screenshot" title="Take Screenshot" aria-label="Take screenshot">${icons.camera(18)}</button>
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

        ${isPreviewing ? `
          <p class="text-xs-muted">
            <kbd class="code-badge-sm">Enter</kbd> start &nbsp;·&nbsp;
            <kbd class="code-badge-sm">Esc</kbd> cancel
          </p>
        ` : ''}

        ${isIdle ? `
          <p class="text-sm-muted">
            ${canRecord
              ? `Press <kbd class="code-badge">${shortcuts.record === ' ' ? 'Space' : (shortcuts.record || 'R').toUpperCase()}</kbd> to record &nbsp;·&nbsp; <kbd class="code-badge">,</kbd> for settings`
              : `Screen recording requires a desktop browser (Chrome, Edge, or Firefox)`}
          </p>
        ` : ''}
      </div>
    </div>
  `;

  // Bind events
  container.querySelector('#btn-start')?.addEventListener('click', onStart);
  container.querySelector('#btn-upload')?.addEventListener('click', onUpload);
  container.querySelector('#btn-screenshot')?.addEventListener('click', onScreenshot);
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
