// Takus — App Shell (state router + orchestrator)
import { States } from '../lib/state-machine.js';
import { Recorder, generateFilename, formatDuration, formatSize } from '../lib/recorder.js';
import { GoogleAuth } from '../lib/google-auth.js';
import { GoogleDrive } from '../lib/google-drive.js';
import { GoogleCalendar } from '../lib/google-calendar.js';
import { getConfig } from '../lib/config.js';
import { saveRecording } from '../lib/storage.js';
import { renderHeader } from './header.js';
import { renderHeroSection } from './hero-section.js';
import { renderRecorderPanel, updateRecorderStats } from './recorder-panel.js';
import { renderPreviewCanvas, showPreview, hidePreview, startAudioMeter, stopAudioMeter } from './preview-canvas.js';
import { renderSettingsPanel, getSettings } from './settings-panel.js';
import { renderDrivePanel } from './drive-panel.js';
import { renderHistoryPanel } from './history-panel.js';
import { renderConsentNotice } from './consent-notice.js';
import { renderUploadProgress } from './upload-progress.js';
import { toast } from './toast.js';

export class AppShell {
  constructor(rootEl, stateMachine) {
    this.root = rootEl;
    this.sm = stateMachine;
    this.recorder = new Recorder();
    this.drive = new GoogleDrive();
    this.calendar = new GoogleCalendar();
    this._lastBlob = null;
    this._lastFilename = '';
    this._uploadState = { loaded: 0, total: 0, link: '', error: '' };

    this.sm.onTransition(() => this.render());
    this._setupKeyboard();
    this._setupBeforeUnload();
  }

  async init() {
    this.render();
    // Init Google Auth in background
    const auth = GoogleAuth.getInstance();
    auth.init().catch(e => console.warn('[App] Google init failed:', e.message));
  }

  render() {
    const state = this.sm.state;
    const isActive = [States.RECORDING, States.PAUSED, States.PREVIEWING, States.REQUESTING_ACCESS].includes(state);
    const isPostRecord = [States.PROCESSING, States.UPLOADING, States.COMPLETE, States.UPLOAD_FAILED].includes(state);

    this.root.innerHTML = `
      <div class="app-layout">
        <div id="header-slot"></div>
        <div class="main-content">
          ${state === States.IDLE ? '<div id="hero-slot"></div>' : ''}
          ${isActive ? '<div id="preview-slot"></div>' : ''}
          ${isPostRecord ? '<div id="upload-slot"></div>' : ''}
          <div id="recorder-slot"></div>
          ${state === States.IDLE ? '<div id="consent-slot"></div>' : ''}
          ${state === States.IDLE ? `
            <div class="two-column">
              <div id="history-slot"></div>
              <div class="sidebar">
                <div id="settings-slot"></div>
                <div id="drive-slot"></div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Render sub-components
    renderHeader(document.getElementById('header-slot'));

    if (state === States.IDLE) {
      renderHeroSection(document.getElementById('hero-slot'));
      renderConsentNotice(document.getElementById('consent-slot'));
      renderSettingsPanel(document.getElementById('settings-slot'));
      renderDrivePanel(document.getElementById('drive-slot'));
      renderHistoryPanel(document.getElementById('history-slot'));
    }

    if (isActive) {
      renderPreviewCanvas(document.getElementById('preview-slot'));
      if (this.recorder.stream) {
        showPreview(this.recorder.stream);
        if (state === States.RECORDING) startAudioMeter(this.recorder);
      }
    }

    if (isPostRecord) {
      const slot = document.getElementById('upload-slot');
      if (state === States.PROCESSING) {
        renderUploadProgress(slot, { status: 'processing' });
      } else if (state === States.UPLOADING) {
        renderUploadProgress(slot, { status: 'uploading', ...this._uploadState });
      } else if (state === States.COMPLETE) {
        renderUploadProgress(slot, { status: 'complete', link: this._uploadState.link, onDismiss: () => this._reset() });
      } else if (state === States.UPLOAD_FAILED) {
        renderUploadProgress(slot, {
          status: 'failed', error: this._uploadState.error,
          onRetry: () => this._doUpload(),
          onDownload: () => this._downloadLocal(),
        });
      }
    }

    renderRecorderPanel(document.getElementById('recorder-slot'), state, {
      onStart: () => this._handleStart(),
      onPause: () => this._handlePause(),
      onResume: () => this._handleResume(),
      onStop: () => this._handleStop(),
    });
  }

  async _handleStart() {
    if (this.sm.state === States.IDLE) {
      this.sm.transition(States.REQUESTING_ACCESS);
      try {
        const stream = await this.recorder.requestStreams();
        this.sm.transition(States.PREVIEWING);
        showPreview(stream);
      } catch (e) {
        console.error('[App] Stream request failed:', e);
        toast.error('Access denied', e.message || 'Could not access screen');
        this.sm.transition(States.IDLE);
      }
    } else if (this.sm.state === States.PREVIEWING) {
      const settings = getSettings();
      this.recorder.onTick((elapsed, size) => updateRecorderStats(elapsed, size));
      this.recorder.onStop((blob) => this._onRecordingComplete(blob));
      this.recorder.onError((err) => { toast.error('Recording error', err.message); });
      this.recorder.start(settings.videoQuality, settings.audioQuality);
      this.sm.transition(States.RECORDING);
      startAudioMeter(this.recorder);
      toast.info('Recording started', 'Press S to stop');
    }
  }

  _handlePause() {
    this.recorder.pause();
    stopAudioMeter();
    this.sm.transition(States.PAUSED);
  }

  _handleResume() {
    this.recorder.resume();
    this.sm.transition(States.RECORDING);
    startAudioMeter(this.recorder);
  }

  _handleStop() {
    if (this.sm.state === States.PREVIEWING) {
      // Cancel — cleanup without recording
      this.recorder.cleanup();
      hidePreview();
      this.sm.transition(States.IDLE);
      return;
    }
    stopAudioMeter();
    this.recorder.stop();
    // onStop callback will trigger _onRecordingComplete
  }

  async _onRecordingComplete(blob) {
    const settings = getSettings();
    const cfg = getConfig();
    this._lastBlob = blob;
    this._lastFilename = generateFilename(cfg.drive.fileNamePattern, settings.title) + '.webm';

    this.sm.transition(States.PROCESSING);
    hidePreview();

    // Save to history
    const recordId = 'rec_' + Date.now();
    const historyEntry = {
      id: recordId,
      title: settings.title || 'Untitled Recording',
      date: Date.now(),
      duration: this.recorder.elapsed,
      size: blob.size,
      driveLink: null,
    };

    this.recorder.cleanup();

    // Upload to Drive if connected
    const auth = GoogleAuth.getInstance();
    if (auth.isConnected) {
      await this._doUpload(historyEntry);
    } else {
      // Download locally
      this._downloadLocal();
      await saveRecording(historyEntry).catch(() => {});
      this._reset();
      toast.success('Recording saved', 'Downloaded to your computer');
    }
  }

  async _doUpload(historyEntry) {
    if (!this._lastBlob) return;

    this._uploadState = { loaded: 0, total: this._lastBlob.size, link: '', error: '' };
    this.sm.transition(States.UPLOADING);

    try {
      const result = await this.drive.uploadResumable(
        this._lastBlob,
        this._lastFilename,
        (loaded, total) => {
          this._uploadState.loaded = loaded;
          this._uploadState.total = total;
          // Update progress in-place without full re-render
          const fill = this.root.querySelector('.progress-fill');
          const stats = this.root.querySelector('.upload-stats');
          if (fill) fill.style.width = `${Math.round((loaded/total)*100)}%`;
          if (stats) stats.innerHTML = `<span>${formatSize(loaded)} / ${formatSize(total)}</span><span>${Math.round((loaded/total)*100)}%</span>`;
        }
      );

      this._uploadState.link = result.link;

      // Update history with drive link
      if (historyEntry) {
        historyEntry.driveLink = result.link;
        await saveRecording(historyEntry).catch(() => {});
      }

      // Try calendar integration
      try {
        const cfg = getConfig();
        if (cfg.calendar.enabled) {
          const event = await this.calendar.findMatchingEvent(this.recorder.startTime || Date.now());
          if (event) {
            await this.calendar.addRecordingLink(event.id, result.link, this._lastFilename);
            toast.success('Calendar updated', `Added to "${event.summary}"`);
          }
        }
      } catch (e) {
        console.warn('[App] Calendar integration failed:', e);
      }

      this.sm.transition(States.COMPLETE);
      toast.success('Upload complete', 'Recording saved to Google Drive');
    } catch (e) {
      console.error('[App] Upload failed:', e);
      this._uploadState.error = e.message;
      this.sm.transition(States.UPLOAD_FAILED);
      toast.error('Upload failed', e.message);
    }
  }

  _downloadLocal() {
    if (!this._lastBlob) return;
    const url = URL.createObjectURL(this._lastBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this._lastFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  _reset() {
    this._lastBlob = null;
    this._lastFilename = '';
    this._uploadState = { loaded: 0, total: 0, link: '', error: '' };
    this.sm.reset();
  }

  _setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't capture when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      if (e.key.toLowerCase() === 'r' && this.sm.is(States.IDLE)) {
        e.preventDefault();
        this._handleStart();
      } else if (e.key === ' ' && this.sm.is(States.RECORDING)) {
        e.preventDefault();
        this._handlePause();
      } else if (e.key === ' ' && this.sm.is(States.PAUSED)) {
        e.preventDefault();
        this._handleResume();
      } else if (e.key.toLowerCase() === 's' && this.sm.is(States.RECORDING, States.PAUSED)) {
        e.preventDefault();
        this._handleStop();
      }
    });
  }

  _setupBeforeUnload() {
    window.addEventListener('beforeunload', (e) => {
      if (this.sm.is(States.RECORDING, States.PAUSED, States.UPLOADING)) {
        e.preventDefault();
        // Modern browsers ignore custom messages but still show a prompt
      }
    });
  }
}
