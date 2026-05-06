// Takus — App Shell (state router + orchestrator)
import { States } from '../lib/state-machine.js';
import { Recorder, generateFilename, formatDuration, formatSize } from '../lib/recorder.js';
import { FacecamManager } from '../lib/facecam.js';
import { CloudProviderManager } from '../lib/cloud-provider.js';
import { getConfig } from '../lib/config.js';
import { saveRecording, getSetting } from '../lib/storage.js';
import { renderHeader, updateHeaderRecTime } from './header.js';
import { renderHeroSection } from './hero-section.js';
import { renderRecorderPanel, updateRecorderStats } from './recorder-panel.js';
import { renderPreviewCanvas, showPreview, hidePreview, startAudioMeter, stopAudioMeter } from './preview-canvas.js';
import { renderSettingsPanel, getSettings, getShortcuts } from './settings-panel.js';
import { renderHistoryPanel } from './history-panel.js';
import { renderReviewPanel } from './review-panel.js';
import { renderConsentNotice, renderFooter } from './consent-notice.js';
import { renderUploadProgress } from './upload-progress.js';
import { toast } from './toast.js';
import { extractAudio, convertToMP4, addWatermark, convertToGIF } from '../lib/ffmpeg-engine.js';
import { generateTranscriptionAndSummary } from '../lib/ai-engine.js';

export class AppShell {
  constructor(rootEl, stateMachine) {
    this.root = rootEl;
    this.sm = stateMachine;
    this.recorder = new Recorder();
    this.facecam = new FacecamManager();
    this.cpm = CloudProviderManager.getInstance();
    this._lastBlob = null;
    this._lastFilename = '';
    this._uploadState = { loaded: 0, total: 0, link: '', error: '' };
    this._lastHistoryEntry = null;
    this._pendingTitle = '';
    this._recordingStartTime = null;
    this._shortcuts = { record: 'r', pause: ' ', stop: 's' };

    this.sm.onTransition(() => this.render());
    // Re-render when user manually closes PiP window so camera button icon updates
    this.facecam._onDeactivate = () => this.render();
    this._setupKeyboard();
    this._setupBeforeUnload();
  }

  async init() {
    // Pre-load shortcuts so the keyboard handler doesn't hit IndexedDB on every keystroke.
    try { this._shortcuts = await getShortcuts(); } catch {}
    this.render();
    // Init cloud providers in background
    this.cpm.google.auth.init().catch(e => console.warn('[App] Google init failed:', e.message));
    // Microsoft init is lazy — triggered on first connect attempt
  }

  async _refreshShortcuts() {
    try { this._shortcuts = await getShortcuts(); } catch {}
  }

  render() {
    const state = this.sm.state;
    const isActive = [States.RECORDING, States.PAUSED, States.PREVIEWING, States.REQUESTING_ACCESS].includes(state);
    const isPostRecord = [States.PROCESSING, States.UPLOADING, States.COMPLETE, States.UPLOAD_FAILED].includes(state);

    // Cinematic Mode Toggle + Tab title
    if (state === States.RECORDING || state === States.PAUSED) {
      document.body.classList.add('cinematic-mode');
    } else {
      document.body.classList.remove('cinematic-mode');
      document.title = 'Takus — Free Screen Recorder with Cloud Storage';
    }

    this.root.innerHTML = `
      <div class="app-layout">
        <div id="header-slot"></div>
        <div class="main-content">
          ${state === States.IDLE ? '<div id="hero-slot"></div>' : ''}
          ${isActive ? '<div id="preview-slot"></div>' : ''}
          ${state === States.REVIEWING ? '<div id="review-slot"></div>' : ''}
          ${isPostRecord ? '<div id="upload-slot"></div>' : ''}
          <div id="recorder-slot"></div>
          ${state === States.IDLE ? '<div id="consent-slot"></div>' : ''}
          ${state === States.IDLE ? `
            <div class="two-column">
              <div id="history-slot"></div>
              <div class="sidebar">
                <div id="settings-slot"></div>
              </div>
            </div>
            <div id="footer-slot"></div>
          ` : ''}
        </div>
      </div>
    `;

    // Render sub-components
    renderHeader(document.getElementById('header-slot'), state);

    if (state === States.IDLE) {
      renderHeroSection(document.getElementById('hero-slot'));
      renderConsentNotice(document.getElementById('consent-slot'));
      renderSettingsPanel(document.getElementById('settings-slot'));
      renderHistoryPanel(document.getElementById('history-slot'));
      renderFooter(document.getElementById('footer-slot'));
      // Settings panel may have changed shortcut bindings since last paint.
      this._refreshShortcuts();
    }

    if (isActive) {
      renderPreviewCanvas(document.getElementById('preview-slot'));
      if (this.recorder.stream) {
        showPreview(this.recorder.stream);
        if (state === States.RECORDING) startAudioMeter(this.recorder);
      }
    }

    if (state === States.REVIEWING) {
      renderReviewPanel(document.getElementById('review-slot'), this._lastBlob, {
        onApprove: (blob) => {
          this._lastBlob = blob;
          this.sm.transition(States.PROCESSING);
          this._onRecordingApproved(blob);
        },
        onDiscard: () => {
          this._reset();
        }
      });
    }

    if (isPostRecord) {
      const slot = document.getElementById('upload-slot');
      if (state === States.PROCESSING) {
        renderUploadProgress(slot, { status: 'processing' });
      } else if (state === States.UPLOADING) {
        renderUploadProgress(slot, { status: 'uploading', ...this._uploadState });
      } else if (state === States.COMPLETE) {
        renderUploadProgress(slot, { 
          status: 'complete', 
          link: this._uploadState.link, 
          onDismiss: () => this._reset(),
          onDownloadMP4: () => this._downloadMP4(),
          onDownloadGIF: () => this._downloadGIF()
        });
      } else if (state === States.UPLOAD_FAILED) {
        renderUploadProgress(slot, {
          status: 'failed', error: this._uploadState.error,
          onRetry: () => this._doUpload(this._lastHistoryEntry),
          onDownload: () => { this._downloadLocal(); toast.success('Recording saved', 'Downloaded to your computer'); },
        });
      }
    }

    renderRecorderPanel(document.getElementById('recorder-slot'), state, {
      isCameraActive: this.facecam.isActive,
      onStart: () => this._handleStart(),
      onPause: () => this._handlePause(),
      onResume: () => this._handleResume(),
      onStop: () => this._handleStop(),
      onToggleCamera: () => this._toggleFacecam(),
    });
  }

  async _handleStart() {
    if (this.sm.state === States.IDLE) {
      // Guard against double-click/rapid invocations
      if (this._startLock) return;
      this._startLock = true;
      // Capture the meeting title BEFORE the IDLE DOM is replaced — the input
      // is destroyed when we transition to REQUESTING_ACCESS.
      const idleSettings = getSettings();
      this._pendingTitle = idleSettings.title || '';
      this.sm.transition(States.REQUESTING_ACCESS);
      try {
        // Wire stop-sharing handler before requesting streams so it covers PREVIEWING too.
        this.recorder.onTrackEnded(() => {
          if (this.sm.is(States.PREVIEWING, States.REQUESTING_ACCESS)) {
            this.recorder.cleanup();
            hidePreview();
            this.facecam.stop();
            this._startLock = false;
            this.sm.transition(States.IDLE);
            toast.info('Stopped', 'Screen sharing was cancelled.');
          }
        });
        const stream = await this.recorder.requestStreams();
        this.sm.transition(States.PREVIEWING);
        showPreview(stream);
        this._startLock = false;
      } catch (e) {
        console.error('[App] Stream request failed:', e);
        const reason = e?.name === 'NotAllowedError' ? 'Permission denied' : (e?.message || 'Could not access screen');
        toast.error('Access denied', reason);
        this.recorder.cleanup();
        this.sm.transition(States.IDLE);
        this._startLock = false;
      }
    } else if (this.sm.state === States.PREVIEWING) {
      // Guard against double-click during countdown
      if (this._startLock) return;
      this._startLock = true;

      const settings = getSettings();
      this.recorder.onTick((elapsed, size) => {
        updateRecorderStats(elapsed, size);
        updateHeaderRecTime(elapsed);
        // Update tab title with elapsed time
        const s = Math.floor(elapsed / 1000) % 60;
        const m = Math.floor(elapsed / 60000) % 60;
        const h = Math.floor(elapsed / 3600000);
        document.title = `⏺ ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} — Takus`;
        // Safety limit — 60 minutes max to prevent runaway memory usage
        if (elapsed >= 3_600_000 && this.sm.is(States.RECORDING)) {
          toast.warning('Time limit reached', 'Recording auto-stopped at 60 minutes.');
          this._handleStop();
        }
      });
      this.recorder.onStop((blob) => {
        // Clean up resources — this callback fires both from _handleStop() and from
        // the browser's "Stop Sharing" button, so we must handle cleanup here too.
        stopAudioMeter();
        this.facecam.stop();

        // Guard against empty or tiny blobs from very short recordings
        if (!blob || blob.size < 1024) {
          console.warn('[App] Recording too short or empty:', blob?.size, 'bytes');
          toast.warning('Recording too short', 'Please record for at least a few seconds.');
          this.recorder.cleanup();
          hidePreview();
          this.sm.transition(States.IDLE);
          return;
        }
        this._lastBlob = blob;
        this.sm.transition(States.REVIEWING);
      });
      this.recorder.onError((err) => { toast.error('Recording error', err?.message || 'Recording failed'); });

      // 3-2-1 countdown before starting
      await this._showCountdown();

      // If user cancelled (ESC) during countdown, state is no longer PREVIEWING.
      // Abort silently — don't show a misleading "Could not start recording" error.
      if (this.sm.state !== States.PREVIEWING) {
        this._startLock = false;
        return;
      }

      try {
        this.recorder.start(settings.videoQuality, settings.audioQuality);
      } catch (e) {
        console.error('[App] Recorder.start failed:', e);
        toast.error('Could not start recording', e?.message || '');
        this.recorder.cleanup();
        hidePreview();
        this.sm.transition(States.IDLE);
        this._startLock = false;
        return;
      }
      this._recordingStartTime = this.recorder.startTime;
      this.sm.transition(States.RECORDING);
      this._startLock = false;
      startAudioMeter(this.recorder);
      const stopKeyHint = (this._shortcuts.stop || 's').toUpperCase();
      toast.info('Recording started', `Press ${stopKeyHint} to stop`);
    }
  }

  _handlePause() {
    this.recorder.pause();
    stopAudioMeter();
    document.title = '⏸ Paused — Takus';
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
      this.facecam.stop();
      this.sm.transition(States.IDLE);
      return;
    }
    // Normal recording stop — audio meter and facecam cleanup
    // are handled in the onStop callback (which also fires from
    // the browser's native "Stop Sharing" button).
    this.recorder.stop();
    // onStop callback will trigger transition to REVIEWING
  }

  async _onRecordingApproved(blob) {
    const cfg = getConfig();
    // Title was captured before the IDLE DOM was destroyed.
    const title = this._pendingTitle || 'Untitled Recording';
    // Pull watermark/auto-copy from persisted storage rather than DOM (which is gone).
    const watermarkText = (await getSetting('watermarkText')) || '';
    this._lastFilename = generateFilename(cfg.drive.fileNamePattern, title) + '.webm';

    // Capture duration BEFORE cleanup wipes startTime.
    const duration = this.recorder.elapsed;

    // Save to history
    const recordId = 'rec_' + Date.now();
    const historyEntry = {
      id: recordId,
      title,
      date: Date.now(),
      duration,
      size: blob.size,
      driveLink: null,
      aiSummary: null,
      aiTranscript: null,
      aiVtt: null,
    };

    this.recorder.cleanup();
    
    let processedBlob = blob;

    // Add watermark if configured
    if (watermarkText) {
      toast.info('Watermarking', 'Applying custom watermark to video...');
      try {
        processedBlob = await addWatermark(blob, watermarkText, (progress) => {
          const fill = this.root.querySelector('.progress-fill');
          const stats = this.root.querySelector('.upload-stats');
          if (fill) fill.style.width = `${Math.round(progress*100)}%`;
          if (stats) stats.innerHTML = `<span>Watermarking...</span><span>${Math.round(progress*100)}%</span>`;
        });
      } catch (e) {
        console.warn('[App] Watermark failed:', e);
        toast.error('Watermark Failed', 'Skipping watermark application.');
      }
    }
    
    // Create a promise that AI processing can await to ensure driveLink is set
    let resolveUpload;
    this._uploadDone = new Promise((r) => { resolveUpload = r; });

    // Kick off AI transcription in background if configured
    this._processAI(processedBlob, historyEntry);

    // Upload to cloud if connected
    const provider = this.cpm.getProvider();
    if (provider && provider.auth.isConnected) {
      this._lastBlob = processedBlob; // ensure the uploader uses the watermarked version
      await this._doUpload(historyEntry);
      resolveUpload();
    } else {
      this._lastBlob = processedBlob;
      // Download locally
      this._downloadLocal();
      await saveRecording(historyEntry).catch(() => {});
      resolveUpload();
      this._reset();
      toast.success('Recording saved', 'Downloaded to your computer');
    }
  }

  async _doUpload(historyEntry) {
    if (!this._lastBlob) return;
    // Store for retry access
    if (historyEntry) this._lastHistoryEntry = historyEntry;

    this._uploadState = { loaded: 0, total: this._lastBlob.size, link: '', error: '' };
    this.sm.transition(States.UPLOADING);

    try {
      const provider = this.cpm.getProvider();
      if (!provider) throw new Error('No cloud provider connected');
      const result = await provider.storage.uploadResumable(
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

      // Try calendar integration — use the recording start time we captured before cleanup
      try {
        const cfg = getConfig();
        if (cfg.calendar.enabled && provider.calendar) {
          const event = await provider.calendar.findMatchingEvent(this._recordingStartTime || Date.now());
          if (event) {
            await provider.calendar.addRecordingLink(event.id, result.link, this._lastFilename);
            toast.success('Calendar updated', `Added to "${event.summary}"`);
          }
        }
      } catch (e) {
        console.warn('[App] Calendar integration failed:', e);
      }

      this.sm.transition(States.COMPLETE);
      toast.success('Upload complete', `Recording saved to ${provider.name}`);

      // autoCopyLink defaults to true — null/undefined should not disable it.
      const autoCopySetting = await getSetting('autoCopyLink');
      if (autoCopySetting !== false) {
        try {
          await navigator.clipboard.writeText(result.link);
          toast.success('Link Copied', 'Copied to clipboard automatically.');
        } catch (err) {
          console.warn('[Clipboard] Failed to copy:', err);
        }
      }
      
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
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async _downloadMP4() {
    if (!this._lastBlob) return;
    toast.info('Converting to MP4', 'This may take a moment depending on recording length.');
    try {
      const mp4Blob = await convertToMP4(this._lastBlob);
      const url = URL.createObjectURL(mp4Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this._lastFilename.replace('.webm', '.mp4');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      console.error('[App] MP4 conversion failed:', e);
      toast.error('Conversion failed', 'Could not convert to MP4.');
    }
  }

  async _downloadGIF() {
    if (!this._lastBlob) return;
    toast.info('Converting to GIF', 'This may take a moment depending on recording length.');
    try {
      const gifBlob = await convertToGIF(this._lastBlob);
      const url = URL.createObjectURL(gifBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this._lastFilename.replace('.webm', '.gif');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      console.error('[App] GIF conversion failed:', e);
      toast.error('Conversion failed', 'Could not convert to GIF.');
    }
  }

  async _processAI(blob, historyEntry) {
    const openaiKey = await getSetting('openaiKey');
    if (!openaiKey) return;
    
    toast.info('AI Assistant', 'Generating transcript & summary...');
    try {
      const audioBlob = await extractAudio(blob);
      const { transcript, summary, vtt } = await generateTranscriptionAndSummary(audioBlob, openaiKey);
      
      historyEntry.aiTranscript = transcript;
      historyEntry.aiSummary = summary;
      historyEntry.aiVtt = vtt;
      
      // Wait for the upload to finish so we have historyEntry.driveLink
      // before creating the Google Doc. _uploadDone is set by _doUpload.
      if (this._uploadDone) {
        await this._uploadDone.catch(() => {}); // Don't fail AI if upload failed
      }

      // Attempt to create meeting notes document
      const provider = this.cpm.getProvider();
      if (provider && provider.auth.isConnected && provider.notes) {
        try {
          const docLink = await provider.notes.createMeetingDoc(historyEntry.title, summary, transcript, historyEntry.driveLink);
          historyEntry.aiDocLink = docLink;
        } catch (docErr) {
          console.warn('[AI] Could not create meeting notes:', docErr);
        }
      }

      await saveRecording(historyEntry);
      
      toast.success('AI Complete', 'Meeting summary and document are ready');
      // Re-render history if idle
      if (this.sm.is(States.IDLE)) renderHistoryPanel(document.getElementById('history-slot'));
    } catch (e) {
      console.warn('[AI] Processing failed:', e);
      toast.error('AI Processing Failed', e.message);
    }
  }

  async _toggleFacecam() {
    try {
      await this.facecam.toggle();
      this.render();
    } catch (e) {
      toast.error('Camera Error', e.message || 'Could not access webcam.');
    }
  }

  _showCountdown() {
    return new Promise((resolve) => {
      const preview = document.getElementById('preview-box');
      if (!preview) { resolve(); return; }

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:20;border-radius:var(--radius-lg);';
      const countEl = document.createElement('div');
      countEl.style.cssText = 'font-size:80px;font-weight:800;color:#fff;text-shadow:0 0 40px rgba(124,58,237,0.6);transition:transform 0.3s ease,opacity 0.3s ease;';
      overlay.appendChild(countEl);
      preview.appendChild(overlay);

      let count = 3;
      const tick = () => {
        if (count <= 0) {
          overlay.remove();
          resolve();
          return;
        }
        countEl.style.transform = 'scale(1.3)';
        countEl.style.opacity = '1';
        countEl.textContent = count;
        setTimeout(() => {
          countEl.style.transform = 'scale(0.8)';
          countEl.style.opacity = '0.3';
        }, 600);
        count--;
        setTimeout(tick, 1000);
      };
      tick();
    });
  }

  _reset() {
    this._lastBlob = null;
    this._lastFilename = '';
    this._uploadState = { loaded: 0, total: 0, link: '', error: '' };
    this._lastHistoryEntry = null;
    this._startLock = false;
    this.facecam.stop();
    document.title = 'Takus — Free Screen Recorder with Cloud Storage';
    this.sm.reset();
  }

  _setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't capture when typing in inputs
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

      const shortcuts = this._shortcuts;
      const key = e.key === ' ' ? ' ' : e.key.toLowerCase();

      if (key === shortcuts.record && this.sm.is(States.IDLE)) {
        e.preventDefault();
        this._handleStart();
      } else if (key === shortcuts.pause && this.sm.is(States.RECORDING)) {
        e.preventDefault();
        this._handlePause();
      } else if (key === shortcuts.pause && this.sm.is(States.PAUSED)) {
        e.preventDefault();
        this._handleResume();
      } else if (key === shortcuts.stop && this.sm.is(States.RECORDING, States.PAUSED)) {
        e.preventDefault();
        this._handleStop();
      } else if (e.key === 'Escape' && this.sm.is(States.PREVIEWING, States.REQUESTING_ACCESS)) {
        e.preventDefault();
        this._handleStop();
      }
    });

    // Listen for changes to shortcut settings via storage events (multi-tab) and a focus event.
    window.addEventListener('focus', () => this._refreshShortcuts());
  }

  _setupBeforeUnload() {
    window.addEventListener('beforeunload', (e) => {
      if (this.sm.is(States.RECORDING, States.PAUSED, States.UPLOADING, States.REVIEWING, States.PROCESSING)) {
        e.preventDefault();
        // Modern browsers ignore custom messages but still show a prompt
      }
    });
  }
}
