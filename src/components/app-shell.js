// Takus — App Shell (state router + orchestrator)
import { States } from '../lib/state-machine.js';
import { Recorder, generateFilename, formatDuration, formatSize } from '../lib/recorder.js';
import { FacecamManager } from '../lib/facecam.js';
import { CloudProviderManager } from '../lib/cloud-provider.js';
import { getConfig, isMicrosoftConfigured } from '../lib/config.js';
import { saveRecording, saveRecoveryChunk, getRecoveryData, clearRecoveryData, saveRecordingBlob } from '../lib/storage.js';
import { renderHeader, updateHeaderRecTime } from './header.js';
import { renderRecorderPanel, updateRecorderStats } from './recorder-panel.js';
import { renderPreviewCanvas, showPreview, hidePreview, startAudioMeter, stopAudioMeter } from './preview-canvas.js';
import { initSettings, getSettings, getShortcuts, openSettingsModal } from './settings-panel.js';
import { renderSessionConfig, getSessionTitle, cleanupSessionConfig } from './session-config.js';
import { icons } from '../lib/icons.js';
import { renderHistoryPanel } from './history-panel.js';
import { renderReviewPanel } from './review-panel.js';
import { renderConsentNotice, renderFooter } from './consent-notice.js';
import { renderUploadProgress, updateProcessingPhase } from './upload-progress.js';
import { renderSharePanel } from './share-panel.js';
import { showTypePicker, typeLabel } from './type-picker.js';
import { toast } from './toast.js';
import { extractAudio, convertToMP4, addWatermark, convertToGIF } from '../lib/ffmpeg-engine.js';
import { generateTranscriptionAndSummary, extractTasks } from '../lib/ai-engine.js';
import { Observer } from '../lib/observer.js';
import { embedTranscript } from '../lib/embeddings.js';
import { saveEmbeddings } from '../lib/storage.js';
import { renderAskPanel, focusAskInput } from './ask-panel.js';
import { renderInsightsPanel } from './insights-panel.js';
import { analyzeFillerWords, computeQualityScore, isUrgentUpdate, buildUrgentUpdateSlackPayload } from '../lib/analytics.js';
import { getIntegrationConfig } from './connect-panel.js';
import { postToSlack } from '../lib/integrations/slack.js';

export class AppShell {
  constructor(rootEl, stateMachine) {
    this.root = rootEl;
    this.sm = stateMachine;
    this.recorder = new Recorder();
    this.facecam = new FacecamManager();
    this.cpm = CloudProviderManager.getInstance();
    this._lastBlob = null;
    this._lastFilename = '';
    this._uploadState = { loaded: 0, total: 0, link: '', error: '', participants: [] };
    this._lastHistoryEntry = null;
    this._pendingTitle = '';
    this._recordingStartTime = null;
    this._shortcuts = { record: 'r', pause: ' ', stop: 's' };
    this._recoveryId = null;
    this._recoveryInterval = null;
    this._startLock = false;
    this._fiftyMinWarned = false;
    this._observer = new Observer();
    this._observerLog = null;
    this._recordingType = null;

    this._installPrompt = null;
    this._originalFavicon = null;
    this.sm.onTransition(() => this.render());
    // Re-render when user manually closes PiP window so camera button icon updates
    this.facecam._onDeactivate = () => this.render();
    this._setupKeyboard();
    this._setupBeforeUnload();
  }

  async init() {
    // PWA install prompt — defer and show a banner after the first user interaction
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._installPrompt = e;
      this._showInstallBanner();
    });

    // Pre-load all settings into the in-memory cache before first render
    await initSettings().catch(() => {});
    try { this._shortcuts = await getShortcuts(); } catch {}

    // If launched via a PWA shortcut with ?type=X, pre-set the recording type so
    // the picker is skipped and the user lands directly in the recording flow.
    const launchType = new URLSearchParams(window.location.search).get('type');
    const validTypes = ['meeting', 'screen', 'presentation'];
    if (launchType && validTypes.includes(launchType)) {
      this._recordingType = launchType;
      history.replaceState(null, '', window.location.pathname);
    }

    this.render();
    // Init cloud providers in background
    this.cpm.google.auth.init().catch(e => console.warn('[App] Google init failed:', e.message));
    // Microsoft init is lazy — triggered on first connect attempt

    // Restore last active provider from localStorage for seamless reconnection
    this._restoreProvider();

    // Check for crash recovery data from a previous session
    this._checkRecovery();
  }

  /** Restore the last-used cloud provider on page load */
  async _restoreProvider() {
    const lastProvider = localStorage.getItem('takus_last_provider');
    if (!lastProvider) return;
    try {
      if (lastProvider === 'microsoft') {
        // MSAL stores session in sessionStorage — acquireTokenSilent will restore it
        if (isMicrosoftConfigured()) {
          await this.cpm.microsoft.auth.init();
          // If init found an existing session, _activeId is already set via onChange
        }
      }
      // Google auto-inits above; its silent re-auth happens via GIS prompt=''
    } catch (e) {
      console.warn('[App] Provider restore failed:', e.message);
    }
  }

  /**
   * Check IndexedDB for crash-recovery data and offer to restore.
   *
   * The previous version auto-downloaded immediately on page load — that's
   * a privacy hazard on shared devices, since whoever opens the page next
   * receives the prior user's recording. We now require an explicit click.
   */
  async _checkRecovery() {
    try {
      const recovery = await getRecoveryData('active_recording');
      if (!recovery || !recovery.chunks || recovery.chunks.length === 0) return;

      // Only offer recovery if data is less than 24 hours old
      if (Date.now() - recovery.updatedAt > 86_400_000) {
        await clearRecoveryData('active_recording');
        return;
      }

      const size = recovery.chunks.reduce((s, c) => s + c.size, 0);
      if (size < 1024) {
        await clearRecoveryData('active_recording');
        return;
      }

      this._renderRecoveryBanner(recovery, size);
    } catch (e) {
      console.warn('[App] Recovery check failed:', e.message);
    }
  }

  _renderRecoveryBanner(recovery, size) {
    const existing = document.getElementById('recovery-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'recovery-banner';
    banner.className = 'recovery-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Recovered recording');
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-3);flex:1;min-width:0;">
        <strong>Recovered recording available.</strong>
        <span style="color:var(--color-text-secondary);">${formatSize(size)} from a previous session.</span>
      </div>
      <div style="display:flex;gap:var(--space-2);">
        <button class="btn btn-primary btn-sm" id="recovery-resume" type="button">Resume</button>
        <button class="btn btn-ghost btn-sm" id="recovery-download" type="button">Download</button>
        <button class="btn btn-ghost btn-sm" id="recovery-discard" type="button">Discard</button>
      </div>
    `;
    document.body.appendChild(banner);

    const cleanup = () => banner.remove();
    const _buildBlob = () => new Blob(recovery.chunks, { type: 'video/webm' });
    const _lockButtons = () => {
      banner.querySelectorAll('button').forEach(b => { b.disabled = true; });
    };

    banner.querySelector('#recovery-resume').addEventListener('click', () => {
      _lockButtons();
      try {
        const blob = _buildBlob();
        this._lastBlob = blob;
        this._pendingTitle = `Recovered recording — ${new Date(recovery.updatedAt).toLocaleDateString()}`;
        this._recordingType = null;
        clearRecoveryData('active_recording').catch(() => {});
        cleanup();
        this.sm.transition(States.REVIEWING);
        this.render();
      } catch (e) {
        console.warn('[App] Recovery resume failed:', e);
        toast.error('Recovery failed', e?.message || 'Could not reconstruct the recording');
        cleanup();
      }
    });

    banner.querySelector('#recovery-download').addEventListener('click', () => {
      _lockButtons();
      try {
        const blob = _buildBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recovered-recording-${new Date(recovery.updatedAt).toISOString().slice(0, 10)}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) {
        console.warn('[App] Recovery download failed:', e);
        toast.error('Recovery failed', e?.message || 'Could not reconstruct the recording');
      }
      clearRecoveryData('active_recording').catch(() => {});
      cleanup();
    });

    banner.querySelector('#recovery-discard').addEventListener('click', () => {
      _lockButtons();
      clearRecoveryData('active_recording').catch(() => {});
      cleanup();
    });
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
          ${isActive ? '<div id="preview-slot"></div>' : ''}
          ${state === States.REVIEWING ? '<div id="review-slot"></div>' : ''}
          ${isPostRecord ? '<div id="upload-slot"></div>' : ''}
          <div id="recorder-slot"></div>
          ${state === States.IDLE ? `
            <div id="consent-slot"></div>
            <div id="session-config-slot"></div>
            <div id="onboarding-slot"></div>
            <div id="main-tab-bar" style="display:flex;gap:var(--space-2);padding:0 0 var(--space-1);border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:var(--space-3);">
              <button class="main-tab active" data-tab="history" style="display:flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-primary-light);padding:4px 10px;border-radius:var(--radius-sm);border-bottom:2px solid var(--color-primary-light);"></button>
              <button class="main-tab" data-tab="insights" style="display:flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-muted);padding:4px 10px;border-radius:var(--radius-sm);border-bottom:2px solid transparent;"></button>
            </div>
            <div id="ask-slot" class="tab-panel-history"></div>
            <div id="history-slot" class="tab-panel-history"></div>
            <div id="insights-slot" class="tab-panel-insights" style="display:none;"></div>
            <div id="footer-slot"></div>
          ` : ''}
        </div>
      </div>
    `;

    // Render sub-components
    renderHeader(document.getElementById('header-slot'), state);

    if (state === States.IDLE) {
      renderConsentNotice(document.getElementById('consent-slot'));
      renderSessionConfig(document.getElementById('session-config-slot'));

      // First-run onboarding card — shown until explicitly dismissed
      const onboardingSlot = document.getElementById('onboarding-slot');
      if (onboardingSlot && !localStorage.getItem('takus_welcomed')) {
        onboardingSlot.innerHTML = `
          <div class="card card-compact animate-in" style="background:linear-gradient(135deg,rgba(124,58,237,0.08),rgba(16,185,129,0.06));border-color:rgba(124,58,237,0.2);">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-4);">
              <div>
                <p style="font-weight:var(--weight-semi);color:var(--color-text-primary);margin-bottom:var(--space-3);">Welcome to Takus</p>
                <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:var(--space-2);font-size:var(--font-sm);color:var(--color-text-secondary);">
                  <li style="display:flex;align-items:center;gap:var(--space-2);">${icons.video(13)} Record screen, meetings &amp; presentations in one click</li>
                  <li style="display:flex;align-items:center;gap:var(--space-2);">${icons.cloud(13)} Auto-upload to Google Drive or Microsoft OneDrive</li>
                  <li style="display:flex;align-items:center;gap:var(--space-2);">${icons.zap(13)} AI transcript &amp; summary via OpenAI or Gemini</li>
                  <li style="display:flex;align-items:center;gap:var(--space-2);">${icons.settings(13)} Shortcuts, quality &amp; watermark — configure in Settings</li>
                </ul>
              </div>
              <button id="onboarding-dismiss" class="btn btn-ghost btn-sm" style="flex-shrink:0;white-space:nowrap;">Got it</button>
            </div>
          </div>`;
        document.getElementById('onboarding-dismiss')?.addEventListener('click', () => {
          try { localStorage.setItem('takus_welcomed', '1'); } catch {}
          if (onboardingSlot) onboardingSlot.innerHTML = '';
        });
      }

      const askSlot = document.getElementById('ask-slot');
      if (askSlot) renderAskPanel(askSlot).catch(() => {});
      renderHistoryPanel(document.getElementById('history-slot'), this._shortcuts);
      renderFooter(document.getElementById('footer-slot'));
      this._refreshShortcuts();
      this._initMainTabs();
    }

    if (isActive) {
      renderPreviewCanvas(document.getElementById('preview-slot'));
      if (this.recorder.stream) {
        showPreview(this.recorder.stream);
        if (state === States.RECORDING) startAudioMeter(this.recorder);
      }
    }

    if (state === States.REVIEWING) {
      const provider = this.cpm.getProvider();
      renderReviewPanel(document.getElementById('review-slot'), this._lastBlob, {
        pendingTitle: this._pendingTitle,
        recordingType: this._recordingType,
        hasProvider: !!(provider && provider.auth.isConnected),
        onApprove: (blob, title) => {
          if (title) this._pendingTitle = title;
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
          recordingTitle: this._pendingTitle,
          link: this._uploadState.link,
          participants: this._uploadState.participants || [],
          onDismiss: () => this._reset(),
          onDownloadMP4: () => this._downloadMP4(),
          onDownloadGIF: () => this._downloadGIF(),
          onShare: (participants) => this._handleShare(participants),
        });
      } else if (state === States.UPLOAD_FAILED) {
        renderUploadProgress(slot, {
          status: 'failed',
          error: this._uploadState.error,
          onRetry: () => this._doUpload(this._lastHistoryEntry),
          onDownload: () => {
            this._downloadLocal();
            toast.success('Recording saved', 'Downloaded to your computer');
            this._reset();
          },
          onDismiss: () => this._reset(),
        });
      }
    }

    renderRecorderPanel(document.getElementById('recorder-slot'), state, {
      isCameraActive: this.facecam.isActive,
      recordingType: this._recordingType,
      onStart: () => this._handleStart(),
      onPause: () => this._handlePause(),
      onResume: () => this._handleResume(),
      onStop: () => this._handleStop(),
      onToggleCamera: () => this._toggleFacecam(),
      onScreenshot: () => this._handleScreenshot(),
      shortcuts: this._shortcuts,
    });
  }

  async _handleStart() {
    if (this.sm.state === States.IDLE) {
      // Guard against double-click/rapid invocations
      if (this._startLock) return;
      this._startLock = true;

      // Ask the user what kind of recording they want.
      // Skip the picker if a type was pre-set via URL param or is already selected.
      if (!this._recordingType) {
        const type = await showTypePicker();
        if (!type) {
          this._startLock = false;
          return;
        }
        this._recordingType = type;
      }

      // Capture the title from the session-config bar BEFORE the IDLE DOM is
      // destroyed by the transition to REQUESTING_ACCESS.
      this._pendingTitle = getSessionTitle() || '';
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
        // 50-minute warning — gives the user time to wrap up
        if (elapsed >= 3_000_000 && !this._fiftyMinWarned && this.sm.is(States.RECORDING)) {
          this._fiftyMinWarned = true;
          toast.warning('10 minutes remaining', 'Recording auto-stops at 60 minutes. Finish up soon.');
        }
        // Hard limit — 60 minutes max to prevent runaway memory usage
        if (elapsed >= 3_600_000 && this.sm.is(States.RECORDING)) {
          toast.warning('Time limit reached', 'Recording auto-stopped at 60 minutes.');
          this._handleStop();
        }
      });
      this.recorder.onStop((blob) => {
        // Stop crash recovery saving
        if (this._recoveryInterval) { clearInterval(this._recoveryInterval); this._recoveryInterval = null; }
        // Collect observer data before any cleanup
        this._observerLog = this._observer.stop();
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

        // Clear crash recovery data — recording completed normally
        clearRecoveryData('active_recording').catch(() => {});
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
      this._setRecordingFavicon();
      this._startLock = false;
      startAudioMeter(this.recorder);

      // Start the Observer — captures console errors, network failures, and actions
      this._observerLog = null;
      this._observer.start();

      // Start crash recovery: periodically snapshot chunks to IndexedDB
      this._recoveryId = 'active_recording';
      this._recoveryInterval = setInterval(() => {
        if (this.recorder.chunks.length > 0) {
          saveRecoveryChunk(this._recoveryId, [...this.recorder.chunks]).catch(() => {});
        }
      }, 10_000); // Every 10 seconds
      const stopKeyHint = (this._shortcuts.stop || 's').toUpperCase();
      toast.info('Recording started', `Press ${stopKeyHint} to stop`);
    }
  }

  _handlePause() {
    this.recorder.pause();
    stopAudioMeter();
    this._resetFavicon();
    document.title = '⏸ Paused — Takus';
    this.sm.transition(States.PAUSED);
  }

  _handleResume() {
    this.recorder.resume();
    this.sm.transition(States.RECORDING);
    this._setRecordingFavicon();
    startAudioMeter(this.recorder);
  }

  _handleStop() {
    if (this.sm.state === States.PREVIEWING) {
      // Cancel — cleanup without recording
      this.recorder.cleanup();
      hidePreview();
      this.facecam.stop();
      if (this._recoveryInterval) { clearInterval(this._recoveryInterval); this._recoveryInterval = null; }
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
    const watermarkText = getSettings().watermarkText || '';
    this._lastFilename = generateFilename(cfg.drive.fileNamePattern, title) + '.webm';

    // Capture duration BEFORE cleanup wipes startTime.
    const duration = this.recorder.elapsed;

    // Mark as having recorded (dismisses first-run onboarding on next render)
    try { localStorage.setItem('takus_welcomed', '1'); } catch {}

    // Save to history
    const recordId = 'rec_' + Date.now();
    const historyEntry = {
      id: recordId,
      title,
      date: Date.now(),
      duration,
      size: blob.size,
      type: this._recordingType || 'screen',
      device: _deviceName(),
      driveLink: null,
      aiSummary: null,
      aiTranscript: null,
      aiVtt: null,
      aiProvider: null,
      tasks: null,
      observerLog: this._observerLog || null,
    };

    this.recorder.cleanup();
    
    let processedBlob = blob;

    // Add watermark if configured
    if (watermarkText) {
      updateProcessingPhase('Applying watermark…', 5, 'Processing video…');
      try {
        processedBlob = await addWatermark(blob, watermarkText, (progress) => {
          const pct = Math.round(5 + progress * 90);
          updateProcessingPhase(null, pct, `Watermarking… ${pct}%`);
        });
        updateProcessingPhase('Watermark applied', 100, 'Done');
      } catch (e) {
        console.warn('[App] Watermark failed:', e);
        toast.error('Watermark Failed', 'Skipping watermark application.');
        updateProcessingPhase('Processing recording…', 0, 'Hang tight…');
      }
    }
    
    // Save blob locally so users can rewatch without cloud (best-effort, silent on quota error)
    saveRecordingBlob(recordId, processedBlob).catch(() => {});

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

    this._uploadState = { loaded: 0, total: this._lastBlob.size, link: '', error: '', participants: this._uploadState.participants || [] };
    this.sm.transition(States.UPLOADING);

    try {
      const provider = this.cpm.getProvider();
      if (!provider) throw new Error('No cloud provider connected');

      // Guard against a stalled upload hanging the app indefinitely.
      // 15 minutes covers even very large recordings on slow connections.
      const _uploadDeadline = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Upload timed out after 15 minutes. Check your connection and try again.')), 15 * 60 * 1000)
      );

      const result = await Promise.race([
        provider.storage.uploadResumable(
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
        ),
        _uploadDeadline,
      ]);

      this._uploadState.link = result.link;

      // Update history with drive link
      if (historyEntry) {
        historyEntry.driveLink = result.link;
        await saveRecording(historyEntry).catch(() => {});
      }

      // Calendar integration only applies to meeting recordings
      try {
        const cfg = getConfig();
        if (this._recordingType === 'meeting' && cfg.calendar.enabled && provider.calendar) {
          const event = await provider.calendar.findMatchingEvent(this._recordingStartTime || Date.now());
          if (event) {
            await provider.calendar.addRecordingLink(event.id, result.link, this._lastFilename);
            toast.success('Calendar updated', `Added to "${event.summary}"`);
            // Extract attendees for post-upload sharing
            if (event.attendees?.length) {
              this._uploadState.participants = event.attendees;
              if (historyEntry) {
                historyEntry.participants = event.attendees;
                await saveRecording(historyEntry).catch(() => {});
              }
            }
          }
        }
      } catch (e) {
        console.warn('[App] Calendar integration failed:', e);
      }

      this.sm.transition(States.COMPLETE);
      toast.success('Upload complete', `Recording saved to ${provider.name}`);

      // Release blob memory — the recording is safely in the cloud now.
      // _lastBlob is only needed for retry (UPLOAD_FAILED) which we've already passed.
      this._lastBlob = null;

      // autoCopyLink defaults to true — null/undefined should not disable it.
      if (getSettings().autoCopyLink !== false) {
        try {
          await navigator.clipboard.writeText(result.link);
          toast.success('Link Copied', 'Copied to clipboard automatically.');
        } catch (err) {
          console.warn('[Clipboard] Failed to copy:', err);
        }
      }
      
    } catch (e) {
      console.error('[App] Upload failed:', e);
      // Persist the entry to history so the recording isn't lost on failure.
      // On retry success, saveRecording() will overwrite it with the drive link.
      if (this._lastHistoryEntry) {
        await saveRecording(this._lastHistoryEntry).catch(() => {});
      }
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
    const aiSettings = getSettings();
    const provider = aiSettings.aiProvider || 'openai';
    const apiKey = provider === 'gemini' ? aiSettings.geminiKey : aiSettings.openaiKey;
    if (!apiKey) return;

    const recType = historyEntry.type || this._recordingType || 'screen';
    toast.info('AI Assistant', 'Generating transcript & summary…');
    try {
      const audioBlob = await extractAudio(blob);
      const { transcript, summary, vtt } = await generateTranscriptionAndSummary(audioBlob, apiKey, recType, provider);

      historyEntry.aiTranscript = transcript;
      historyEntry.aiSummary = summary;
      historyEntry.aiVtt = vtt;
      historyEntry.aiProvider = provider;

      // Extract tasks in parallel while we wait for the upload
      const taskResult = await extractTasks(
        transcript,
        historyEntry.observerLog,
        recType,
        apiKey,
        provider,
      ).catch(() => ({ takusTasks: [], meTasks: [] }));
      historyEntry.tasks = taskResult;

      // Wait for the upload to finish so we have historyEntry.driveLink
      // before creating the Google Doc. _uploadDone is set by _doUpload.
      if (this._uploadDone) {
        await this._uploadDone.catch(() => {}); // Don't fail AI if upload failed
      }

      // Meeting notes doc is only relevant for meeting recordings
      if (recType === 'meeting') {
        const provider = this.cpm.getProvider();
        if (provider && provider.auth.isConnected && provider.notes) {
          try {
            const docLink = await provider.notes.createMeetingDoc(historyEntry.title, summary, transcript, historyEntry.driveLink);
            historyEntry.aiDocLink = docLink;
          } catch (docErr) {
            console.warn('[AI] Could not create meeting notes:', docErr);
          }
        }
      }

      // Phase 4a: browser-side analytics (zero network cost) — run before save
      const fillerAnalysis = analyzeFillerWords(transcript, historyEntry.duration);
      historyEntry.analytics = {
        fillerWords: fillerAnalysis,
        score: computeQualityScore({ ...historyEntry, aiTranscript: transcript }),
      };

      await saveRecording(historyEntry);

      if (isUrgentUpdate(historyEntry)) {
        this._autoRouteUrgentUpdate(historyEntry);
      }

      // Phase 2: Generate transcript embeddings for Ask — non-blocking, best-effort
      if (transcript) {
        this._embedTranscriptInBackground(transcript, historyEntry.id, apiKey, provider);
      }

      const label = typeLabel(recType);
      toast.success('AI Complete', `${label} summary is ready`);
      if (this.sm.is(States.IDLE)) {
        renderHistoryPanel(document.getElementById('history-slot'));
        const askSlot = document.getElementById('ask-slot');
        if (askSlot) renderAskPanel(askSlot).catch(() => {});
        // Re-render insights if it was already opened (data changed); keep rendered flag set
        const insSlot = document.getElementById('insights-slot');
        if (insSlot?.dataset.rendered) {
          renderInsightsPanel(insSlot).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[AI] Processing failed:', e);
      toast.error('AI Processing Failed', e.message);
    }
  }

  async _autoRouteUrgentUpdate(historyEntry) {
    try {
      const slackCfg = await getIntegrationConfig('slack');
      if (!slackCfg.configured) return;
      const payload = buildUrgentUpdateSlackPayload(historyEntry);
      await postToSlack(slackCfg.webhookUrl, payload);
      toast.warning('Urgent update posted to Slack', historyEntry.title);
    } catch (e) {
      console.warn('[Auto-route] Slack post failed:', e.message);
    }
  }

  async _embedTranscriptInBackground(transcript, recordingId, apiKey, provider) {
    try {
      const chunks = await embedTranscript(transcript, recordingId, apiKey, provider);
      if (chunks.length) await saveEmbeddings(recordingId, chunks);
    } catch (e) {
      console.warn('[Embeddings] Background generation failed:', e.message);
    }
  }

  _handleScreenshot() {
    const video = document.getElementById('preview-video');
    if (!video || !video.videoWidth) {
      toast.warning('Screenshot not ready', 'Screen preview is not active.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success('Screenshot saved', 'Downloaded as PNG');
    }, 'image/png');
  }

  _handleShare(participants) {
    renderSharePanel({
      participants,
      recordingTitle: this._pendingTitle,
      driveLink: this._uploadState.link,
      // Read aiSummary at call time so it's available if AI finished after upload
      aiSummary: this._lastHistoryEntry?.aiSummary || '',
    });
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
    this._uploadState = { loaded: 0, total: 0, link: '', error: '', participants: [] };
    this._lastHistoryEntry = null;
    this._startLock = false;
    this._fiftyMinWarned = false;
    this._recordingType = null;
    this._observer.stop(); // no-op if already stopped
    this._observerLog = null;
    document.getElementById('share-overlay')?.remove();
    document.getElementById('type-picker-overlay')?.remove();
    cleanupSessionConfig();
    this.facecam.stop();
    this._resetFavicon();
    document.title = 'Takus — Free Screen Recorder with Cloud Storage';
    this.sm.reset();
  }

  _initMainTabs() {
    const tabBar = document.getElementById('main-tab-bar');
    if (!tabBar) return;

    // Populate labels now that icons module is loaded
    const [histBtn, insBtn] = tabBar.querySelectorAll('.main-tab');
    if (histBtn) histBtn.innerHTML = `${icons.clock(13)} History`;
    if (insBtn)  insBtn.innerHTML  = `${icons.barChart(13)} Insights`;

    tabBar.addEventListener('click', (e) => {
      const tab = e.target.closest('.main-tab');
      if (!tab) return;
      const which = tab.dataset.tab;

      tabBar.querySelectorAll('.main-tab').forEach(b => {
        const active = b === tab;
        b.style.color        = active ? 'var(--color-primary-light)' : 'var(--color-text-muted)';
        b.style.borderBottom = active ? '2px solid var(--color-primary-light)' : '2px solid transparent';
      });

      document.querySelectorAll('.tab-panel-history').forEach(el => {
        el.style.display = which === 'history' ? '' : 'none';
      });
      const insSlot = document.getElementById('insights-slot');
      if (insSlot) {
        insSlot.style.display = which === 'insights' ? '' : 'none';
        if (which === 'insights' && !insSlot.dataset.rendered) {
          insSlot.dataset.rendered = '1';
          renderInsightsPanel(insSlot).catch(() => {});
        }
      }
    });
  }

  _setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't capture when typing in inputs
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      // Don't double-handle Space/Enter when a button currently has focus —
      // the browser's own activation already fires the click handler.
      if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) return;

      const shortcuts = this._shortcuts;
      const key = e.key === ' ' ? ' ' : e.key.toLowerCase();

      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && this.sm.is(States.IDLE)) {
        e.preventDefault();
        focusAskInput();
      } else if (e.key === ',' && this.sm.is(States.IDLE)) {
        e.preventDefault();
        openSettingsModal();
      } else if (key === shortcuts.record && this.sm.is(States.IDLE)) {
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
      } else if (e.key === 'Enter' && this.sm.is(States.PREVIEWING)) {
        e.preventDefault();
        this._handleStart();
      } else if (e.key === 'Escape' && this.sm.is(States.PREVIEWING, States.REQUESTING_ACCESS)) {
        e.preventDefault();
        this._handleStop();
      }
    });

    // Refresh all settings when this tab regains focus (keeps API keys, shortcuts in sync across tabs).
    window.addEventListener('focus', () => initSettings().catch(() => {}).then(() => this._refreshShortcuts()));
  }

  _setRecordingFavicon() {
    const link = document.querySelector("link[rel='icon']");
    if (!link) return;
    if (!this._originalFavicon) this._originalFavicon = link.href;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#ef4444"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>`;
    link.href = `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  _resetFavicon() {
    const link = document.querySelector("link[rel='icon']");
    if (link && this._originalFavicon) link.href = this._originalFavicon;
  }

  _showInstallBanner() {
    if (document.getElementById('install-banner')) return;
    // Don't show if the user already dismissed it
    if (localStorage.getItem('takus_install_dismissed')) return;

    const banner = document.createElement('div');
    banner.id = 'install-banner';
    banner.style.cssText = [
      'position:fixed;bottom:var(--space-6);left:var(--space-4);',
      'display:flex;align-items:center;gap:var(--space-3);',
      'padding:var(--space-3) var(--space-4);',
      'background:rgba(14,14,30,0.95);border:1px solid rgba(124,58,237,0.3);',
      'border-radius:var(--radius-lg);box-shadow:0 8px 32px rgba(0,0,0,0.5);',
      'backdrop-filter:blur(20px);z-index:55;font-size:var(--font-sm);',
      'max-width:320px;animation:slide-in-left 0.3s ease;',
    ].join('');
    banner.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;">
        <span style="font-weight:var(--weight-semi);color:var(--color-text-primary);">Install Takus</span>
        <span style="font-size:var(--font-xs);color:var(--color-text-muted);">Add to home screen for quick access</span>
      </div>
      <button id="install-btn" class="btn btn-primary btn-sm" style="flex-shrink:0;">Install</button>
      <button id="install-dismiss" class="btn btn-ghost btn-icon btn-sm" style="flex-shrink:0;" aria-label="Dismiss">${icons.x(14)}</button>
    `;
    document.body.appendChild(banner);

    banner.querySelector('#install-btn').addEventListener('click', async () => {
      if (!this._installPrompt) return;
      try {
        await this._installPrompt.prompt();
        const { outcome } = await this._installPrompt.userChoice;
        if (outcome === 'accepted') {
          try { localStorage.setItem('takus_install_dismissed', '1'); } catch {}
        }
      } catch {}
      banner.remove();
      this._installPrompt = null;
    });

    banner.querySelector('#install-dismiss').addEventListener('click', () => {
      try { localStorage.setItem('takus_install_dismissed', '1'); } catch {}
      banner.remove();
    });
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

/** Returns a short platform label for the history Device tag */
function _deviceName() {
  const p = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
  if (p.includes("win")) return "Windows";
  if (p.includes("mac")) return "macOS";
  if (p.includes("linux")) return "Linux";
  if (p.includes("iphone") || p.includes("ipad") || p.includes("ios")) return "iOS";
  if (p.includes("android")) return "Android";
  return "Web";
}
