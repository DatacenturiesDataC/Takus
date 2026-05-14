// Takus — App Shell (state router + orchestrator)
import { States } from '../lib/state-machine.js';
import { Recorder, generateFilename, formatDuration, formatSize } from '../lib/recorder.js';
import { FacecamManager } from '../lib/facecam.js';
import { CloudProviderManager } from '../lib/cloud-provider.js';
import { getConfig, isMicrosoftConfigured } from '../lib/config.js';
import { saveRecording, saveRecoveryChunk, getRecoveryData, clearRecoveryData, saveRecordingBlob, saveVaultSync } from '../lib/storage.js';
import { renderHeader, updateHeaderRecTime } from './header.js';
import { renderRecorderPanel, updateRecorderStats } from './recorder-panel.js';
import { renderPreviewCanvas, showPreview, hidePreview, startAudioMeter, stopAudioMeter } from './preview-canvas.js';
import { initSettings, getSettings, getShortcuts, openSettingsModal, renderSettingsInline } from './settings-panel.js';
import { renderSessionConfig, getSessionTitle, cleanupSessionConfig, getSelectedType, getTypePreset } from './session-config.js';
import { icons } from '../lib/icons.js';
import { renderHistoryPanel } from './history-panel.js';
import { renderReviewPanel } from './review-panel.js';
import { renderConsentNotice, renderFooter } from './consent-notice.js';
import { renderUploadProgress, updateProcessingPhase } from './upload-progress.js';
import { renderSharePanel } from './share-panel.js';
import { typeLabel } from './type-picker.js';
import { toast } from './toast.js';
import { extractAudio, addWatermark, preloadFFmpeg } from '../lib/ffmpeg-engine.js';
import { downloadLocal, downloadMP4, downloadGIF } from '../lib/upload-manager.js';
import { renderConnectInline } from './connect-panel.js';
import { processAI } from '../lib/recording-pipeline.js';
import { Observer } from '../lib/observer.js';
import { renderAskPanel, focusAskInput } from './ask-panel.js';
import { openCommandBar } from './command-bar.js';
import { renderInsightsPanel } from './insights-panel.js';
import { setupKeyboardShortcuts } from '../lib/keyboard-manager.js';
import { initDragDrop } from '../lib/drag-drop-handler.js';
import { startClosenessWorker } from '../lib/closeness-worker.js';
import { startAutonomy, onAutonomyEvent } from '../lib/autonomy-engine.js';
import { isTaskPending } from '../lib/task-helpers.js';
import { shortDate, shortTime } from '../lib/utils.js';
import { OPEN_RECORDING, DATE_FILTER, VAULT_SYNC_COMPLETE } from '../lib/events.js';
import { generateId } from '../lib/id.js';

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
    const validTypes = ['meeting', 'screen', 'presentation', 'update'];
    if (launchType && validTypes.includes(launchType)) {
      this._recordingType = launchType;
      history.replaceState(null, '', window.location.pathname);
    }

    // First-run setup wizard — show before the main app renders
    try {
      const { isSetupComplete, showSetupWizard } = await import('./setup-wizard.js');
      if (!(await isSetupComplete())) {
        await showSetupWizard();
      }
    } catch { /* wizard failed — continue normally */ }

    this.render();

    // Start background closeness score recomputation (runs every 24h)
    startClosenessWorker();

    // Start the autonomy engine — background intelligence loop
    startAutonomy();
    const { notifyEphemeral } = await import('../lib/notification-manager.js');
    onAutonomyEvent((type, data) => {
      if (type === 'embed_complete') {
        notifyEphemeral('Knowledge indexed', `Transcript embedded (${data.chunks} chunks)`, 'info');
      } else if (type === 'closeness_recomputed' && data.crossed?.length > 0) {
        notifyEphemeral('Relationships updated', `${data.crossed.length} contact${data.crossed.length > 1 ? 's' : ''} crossed threshold`, 'info');
      }
    });

    // Bridge: notification-manager (lib/) → toast.js (component/)
    // All lib modules emit 'takus:notify' events via notification-manager;
    // this listener is the single point that renders them as visible toasts.
    document.addEventListener('takus:notify', (e) => {
      const { title, body, level } = e.detail;
      toast[level]?.(title, body) || toast.info(title, body);
    });

    document.addEventListener(DATE_FILTER, (e) => {
      if (!this.sm.is(States.IDLE)) return;
      const { date } = e.detail;
      const tabBar = document.getElementById('main-tab-bar');
      const histBtn = tabBar?.querySelector('[data-tab="history"]');
      if (histBtn) histBtn.click();
      const histSlot = document.getElementById('history-slot');
      if (histSlot) renderHistoryPanel(histSlot, this._shortcuts, date);
    });

    // Recording detail drill-down: open the 70/30 detail view
    document.addEventListener(OPEN_RECORDING, async (e) => {
      if (!this.sm.is(States.IDLE)) return;
      const { recording } = e.detail;
      if (!recording) return;

      // Hide all IDLE panels except header
      const elementsToHide = ['session-config-slot', 'onboarding-slot', 'ask-slot', 'main-tab-bar',
        'history-slot', 'tasks-global-slot', 'insights-slot', 'connect-slot', 'settings-slot', 'footer-slot'];
      elementsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      // Create detail slot if it doesn't exist
      let detailSlot = document.getElementById('recording-detail-slot');
      if (!detailSlot) {
        detailSlot = document.createElement('div');
        detailSlot.id = 'recording-detail-slot';
        const askSlot = document.getElementById('ask-slot');
        if (askSlot) askSlot.parentElement.insertBefore(detailSlot, askSlot);
        else document.getElementById('main')?.appendChild(detailSlot);
      }
      detailSlot.style.display = '';

      const { renderRecordingDetail } = await import('./recording-detail.js');
      renderRecordingDetail(detailSlot, recording, () => {
        // Back handler — restore IDLE panels
        detailSlot.style.display = 'none';
        detailSlot.innerHTML = '';
        elementsToHide.forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            // Only show the active tab panel
            if (el.classList.contains('tab-panel')) {
              const tabBar = document.getElementById('main-tab-bar');
              const activeTab = tabBar?.querySelector('.main-tab.active')?.dataset.tab;
              el.style.display = el.dataset.tabPanel === activeTab ? '' : 'none';
            } else {
              el.style.display = '';
            }
          }
        });
      }, (updatedRec) => {
        // Re-render affected panels when a recording changes in detail view
        const histSlot = document.getElementById('history-slot');
        if (histSlot) renderHistoryPanel(histSlot, this._shortcuts);
        // Refresh global tasks panel if it was already rendered
        const tasksSlot = document.getElementById('tasks-global-slot');
        if (tasksSlot?.dataset.rendered) {
          import('./global-tasks-panel.js').then(m => m.renderGlobalTasksPanel(tasksSlot)).catch(() => {});
        }
        // Mark insights as stale so it re-renders on next tab switch
        const insSlot = document.getElementById('insights-slot');
        if (insSlot) delete insSlot.dataset.rendered;
        // Refresh task badge count
        this._updateTaskBadge();
      });
    });

    // Init cloud providers in background
    this.cpm.google.auth.init().catch(e => console.warn('[App] Google init failed:', e.message));
    // Microsoft init is lazy — triggered on first connect attempt

    // Restore last active provider from localStorage for seamless reconnection
    this._restoreProvider();

    // Global drag-and-drop file upload
    this._initDragDrop();

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

  /** Update the pending-tasks badge on the Tasks tab */
  async _updateTaskBadge() {
    // Debounce: skip if another update is already in-flight
    if (this._taskBadgeInFlight) return;
    this._taskBadgeInFlight = true;
    try {
      const recs = await getRecordings();
      let pending = 0;
      for (const rec of recs) {
        const t = rec.tasks;
        if (!t) continue;
        // Phase 15: use status model with legacy fallback
        for (const task of (t.takusTasks || [])) { if (isTaskPending(task)) pending++; }
        for (const task of (t.meTasks || []))    { if (isTaskPending(task)) pending++; }
      }
      // Only touch DOM if the value actually changed
      if (this._cachedPendingCount !== pending) {
        this._cachedPendingCount = pending;
        const badge = document.getElementById('tasks-badge');
        if (badge) {
          badge.textContent = pending > 0 ? (pending > 99 ? '99+' : String(pending)) : '';
          badge.style.display = pending > 0 ? '' : 'none';
        }
      }
    } catch {} finally {
      this._taskBadgeInFlight = false;
    }
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
      document.title = 'Takus — Knowledge OS';
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
            <div id="ask-slot"></div>
            <div id="main-tab-bar" class="main-tab-bar" role="tablist" aria-label="Main navigation">
              <button class="main-tab active" data-tab="history" role="tab" aria-selected="true" aria-controls="history-slot" aria-label="History" id="tab-history"></button>
              <button class="main-tab" data-tab="tasks" role="tab" aria-selected="false" aria-controls="tasks-global-slot" aria-label="Tasks" id="tab-tasks"></button>
              <button class="main-tab" data-tab="insights" role="tab" aria-selected="false" aria-controls="insights-slot" aria-label="Insights" id="tab-insights"></button>
              <button class="main-tab" data-tab="connect" role="tab" aria-selected="false" aria-controls="connect-slot" aria-label="Connect" id="tab-connect"></button>
              <button class="main-tab" data-tab="people" role="tab" aria-selected="false" aria-controls="people-slot" aria-label="People" id="tab-people"></button>
              <button class="main-tab" data-tab="settings" role="tab" aria-selected="false" aria-controls="settings-slot" aria-label="Settings" id="tab-settings"></button>
            </div>
            <div id="history-slot" class="tab-panel" data-tab-panel="history" role="tabpanel" aria-labelledby="tab-history"></div>
            <div id="tasks-global-slot" class="tab-panel" data-tab-panel="tasks" role="tabpanel" aria-labelledby="tab-tasks" style="display:none;"></div>
            <div id="insights-slot" class="tab-panel" data-tab-panel="insights" role="tabpanel" aria-labelledby="tab-insights" style="display:none;"></div>
            <div id="connect-slot" class="tab-panel" data-tab-panel="connect" role="tabpanel" aria-labelledby="tab-connect" style="display:none;"></div>
            <div id="people-slot" class="tab-panel" data-tab-panel="people" role="tabpanel" aria-labelledby="tab-people" style="display:none;"></div>
            <div id="settings-slot" class="tab-panel" data-tab-panel="settings" role="tabpanel" aria-labelledby="tab-settings" style="display:none;"></div>
            <div id="footer-slot"></div>
          ` : ''}
        </div>
      </div>
    `;

    // Render sub-components
    renderHeader(document.getElementById('header-slot'), state);

    if (state === States.IDLE) {
      renderConsentNotice(document.getElementById('consent-slot'));
      renderSessionConfig(document.getElementById('session-config-slot'), {
        isCameraActive: this.facecam.isActive,
        onTypeChange: (typeId, preset) => {
          this._recordingType = typeId;
          // Apply type-driven camera default
          if (preset.camera && !this.facecam.isActive) this._toggleFacecam();
          else if (!preset.camera && this.facecam.isActive) this._toggleFacecam();
        },
        onToggleCamera: () => this._toggleFacecam(),
      });

      // First-run onboarding card — shown until explicitly dismissed
      const onboardingSlot = document.getElementById('onboarding-slot');
      if (onboardingSlot && !localStorage.getItem('takus_welcomed')) {
        onboardingSlot.innerHTML = `
          <div class="card card-compact animate-in" style="background:linear-gradient(135deg,rgba(124,58,237,0.08),rgba(16,185,129,0.06));border-color:rgba(124,58,237,0.2);">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-4);">
              <div>
                <p style="font-weight:var(--weight-semi);color:var(--color-text-primary);margin-bottom:var(--space-1);">Welcome to Takus</p>
                <p style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:var(--space-3);">Your autonomous Knowledge OS</p>
                <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:var(--space-2);font-size:var(--font-sm);color:var(--color-text-secondary);">
                  <li style="display:flex;align-items:center;gap:var(--space-2);">${icons.video(13)} Record meetings, screens &amp; presentations — or upload existing files</li>
                  <li style="display:flex;align-items:center;gap:var(--space-2);">${icons.zap(13)} AI generates transcripts, summaries, titles &amp; action items automatically</li>
                  <li style="display:flex;align-items:center;gap:var(--space-2);">${icons.search(13)} Ask questions across all your recordings with semantic search</li>
                  <li style="display:flex;align-items:center;gap:var(--space-2);">${icons.cloud(13)} Auto-sync to Google Drive or OneDrive — your data, your cloud</li>
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
      // History tab is active by default; other tabs lazy-render on first click
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
      onUpload: () => this._handleUpload(),
      shortcuts: this._shortcuts,
    });
  }

  async _handleStart() {
    if (this.sm.state === States.IDLE) {
      // Guard against double-click/rapid invocations
      if (this._startLock) return;
      this._startLock = true;

      // Use the type from session-config chips (skip picker if already set)
      if (!this._recordingType) {
        this._recordingType = getSelectedType();
      }

      // Title is now AI-generated post-recording
      this._pendingTitle = '';
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

        // Pre-warm FFmpeg in the background so format conversions are instant
        preloadFFmpeg();

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
    // Generate a descriptive default title; replaced by AI-generated title after processing
    const typeName = typeLabel(this._recordingType);
    const title = this._pendingTitle || `${typeName} — ${shortDate(new Date())} ${shortTime(new Date())}`;
    // Pull watermark/auto-copy from persisted storage rather than DOM (which is gone).
    const watermarkText = getSettings().watermarkText || '';
    this._lastFilename = generateFilename(cfg.drive.fileNamePattern, title) + '.webm';

    // Capture duration BEFORE cleanup wipes startTime.
    // For uploaded files, recorder.elapsed is 0 — extract from media metadata.
    let duration = this.recorder.elapsed;
    if (!duration || duration <= 0) {
      duration = await _extractDuration(blob).catch(() => 0);
    }

    // Mark as having recorded (dismisses first-run onboarding on next render)
    try { localStorage.setItem('takus_welcomed', '1'); } catch {}

    // Save to history
    const recordId = generateId('rec');
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
        toast.error('Watermark failed', 'Skipping watermark application.');
        updateProcessingPhase('Processing recording…', 0, 'Hang tight…');
      }
    }
    
    // Save blob locally so users can rewatch without cloud (best-effort, silent on quota error)
    saveRecordingBlob(recordId, processedBlob).catch(() => {});

    // Persist the history entry IMMEDIATELY so it survives upload hangs, crashes,
    // and tab closes. The driveLink will be updated after a successful upload.
    await saveRecording(historyEntry).catch(() => {});
    this._lastRecordingTs = Date.now();

    // Create a promise that AI processing can await to ensure driveLink is set
    let resolveUpload;
    this._uploadDone = new Promise((r) => { resolveUpload = r; });

    // Kick off AI transcription in background if configured
    this._processAI(processedBlob, historyEntry);

    // Upload to cloud if connected
    const provider = this.cpm.getProvider();
    if (provider && provider.auth.isConnected) {
      this._lastBlob = processedBlob; // ensure the uploader uses the watermarked version
      try {
        await this._doUpload(historyEntry);
      } finally {
        // Always resolve so _processAI doesn't hang on upload failure
        resolveUpload();
      }
    } else {
      this._lastBlob = processedBlob;
      // Download locally
      this._downloadLocal();
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

      // Phase 9 VAULT: Use structured package upload if available, fall back to legacy
      const useVault = typeof provider.storage.uploadRecordingPackage === 'function';
      const onProgress = (loaded, total) => {
        this._uploadState.loaded = loaded;
        this._uploadState.total = total;
        const fill = this.root.querySelector('.progress-fill');
        const stats = this.root.querySelector('.upload-stats');
        if (fill) fill.style.width = `${Math.round((loaded/total)*100)}%`;
        if (stats) stats.innerHTML = `<span>${formatSize(loaded)} / ${formatSize(total)}</span><span>${Math.round((loaded/total)*100)}%</span>`;
      };

      const result = await Promise.race([
        useVault
          ? provider.storage.uploadRecordingPackage(
              historyEntry?.id || this._lastFilename.replace('.webm', ''),
              this._lastBlob,
              historyEntry || { date: Date.now(), title: this._lastFilename },
              onProgress
            )
          : provider.storage.uploadResumable(this._lastBlob, this._lastFilename, onProgress),
        _uploadDeadline,
      ]);

      this._uploadState.link = result.link;

      // Update history with drive link
      if (historyEntry) {
        historyEntry.driveLink = result.link;
        if (result.folderId) historyEntry.driveFolderId = result.folderId;
        await saveRecording(historyEntry).catch(() => {});

        // Track vault sync state
        if (useVault && result.folderId) {
          await saveVaultSync({
            id: historyEntry.id,
            driveFolderId: result.folderId,
            drivePackageUploaded: true,
            archiveStatus: 'active',
            pinned: false,
            legalHold: false,
            lastSyncDate: Date.now(),
          }).catch(() => {});
        }
      }

      // Calendar integration only applies to meeting recordings
      try {
        const cfg = getConfig();
        if (this._recordingType === 'meeting' && cfg.calendar.enabled && provider.calendar) {
          const event = await provider.calendar.findMatchingEvent(this._recordingStartTime || Date.now());
          if (event) {
            await provider.calendar.addRecordingLink(event.id, result.link, this._lastFilename);
            toast.success('Calendar updated', `Added to "${event.summary}"`);
            // Persist calendar event + attendees to the recording entry
            if (historyEntry) {
              historyEntry.calendarEvent = {
                id: event.id,
                summary: event.summary,
                start: event.start,
                end: event.end,
                organizer: event.organizer || null,
              };
              if (event.attendees?.length) {
                historyEntry.participants = event.attendees;
                this._uploadState.participants = event.attendees;
              }
              await saveRecording(historyEntry).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.warn('[App] Calendar integration failed:', e);
      }

      this.sm.transition(States.COMPLETE);
      toast.success('Upload complete', `Recording saved to ${provider.name}`);
      this._updateTaskBadge();

      // NOTE: _lastBlob is intentionally retained here so the MP4 / GIF
      // download buttons on the completion screen can still access it.
      // _reset() clears it when the user clicks "New Recording".

      // autoCopyLink defaults to true — null/undefined should not disable it.
      if (getSettings().autoCopyLink !== false) {
        try {
          await navigator.clipboard.writeText(result.link);
          toast.success('Link copied', 'Copied to clipboard automatically.');
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

  _downloadLocal() { downloadLocal(this._lastBlob, this._lastFilename); }
  _downloadMP4()   { downloadMP4(this._lastBlob, this._lastFilename); }
  _downloadGIF()   { downloadGIF(this._lastBlob, this._lastFilename); }

  /** Delegate AI processing to the extracted recording-pipeline module. */
  _processAI(blob, historyEntry) {
    processAI(blob, historyEntry, {
      recordingType: this._recordingType,
      getCloudProvider: () => this.cpm.getProvider(),
      uploadDone: this._uploadDone,
      onPhase: (label, pct, sub) => updateProcessingPhase(label, pct, sub),
      onComplete: () => {
        if (this.sm.is(States.IDLE)) {
          renderHistoryPanel(document.getElementById('history-slot'));
          const askSlot = document.getElementById('ask-slot');
          if (askSlot) renderAskPanel(askSlot);
          const insSlot = document.getElementById('insights-slot');
          if (insSlot?.dataset.rendered) {
            renderInsightsPanel(insSlot).catch(() => {});
          }
        }
      },
    });
  }

  // _autoRouteUrgentUpdate, _syncAIArtefactsToCloud, _embedTranscriptInBackground
  // have been extracted to src/lib/recording-pipeline.js

  /**
   * Handle uploading an existing recording file (video or audio).
   * Opens a file picker, validates format, then enters the review flow.
   */
  async _handleUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/webm,video/mp4,video/quicktime,audio/mp4,audio/wav,audio/mpeg,audio/webm,.webm,.mp4,.m4a,.wav,.mp3,.mov';
    input.style.display = 'none';
    document.body.appendChild(input);

    const file = await new Promise((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] || null));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
    input.remove();

    if (!file) return;

    // Validate size (max 2 GB)
    if (file.size > 2 * 1024 * 1024 * 1024) {
      toast.error('File too large', 'Maximum upload size is 2 GB.');
      return;
    }

    // Validate type
    const ext = file.name.split('.').pop()?.toLowerCase();
    const validExts = ['webm', 'mp4', 'm4a', 'wav', 'mp3', 'mov'];
    if (!validExts.includes(ext)) {
      toast.error('Unsupported format', `Accepted formats: ${validExts.join(', ')}`);
      return;
    }

    toast.success('File loaded', `Processing "${file.name}" (${formatSize(file.size)})`);

    // Set recording type from current session-config selection
    this._recordingType = getSelectedType();
    this._pendingTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    this._lastBlob = file;
    this._recordingStartTime = Date.now();

    this.sm.transition(States.REVIEWING);
    this.render();
  }

  /** Global drag-and-drop file upload */
  _initDragDrop() {
    initDragDrop({
      sm: this.sm,
      States,
      onFileDrop: (file) => {
        this._recordingType = getSelectedType();
        this._pendingTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        this._lastBlob = file;
        this._recordingStartTime = Date.now();
        this.sm.transition(States.REVIEWING);
        this.render();
      },
    });
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
      toast.error('Camera error', e.message || 'Could not access webcam.');
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
    document.title = 'Takus — Knowledge OS';
    this.sm.reset();
  }

  _initMainTabs() {
    const tabBar = document.getElementById('main-tab-bar');
    if (!tabBar) return;

    // Populate labels now that icons module is loaded
    const tabLabels = {
      history:  `${icons.clock(13)} <span class="tab-label">History</span>`,
      tasks:    `${icons.zap(13)} <span class="tab-label">Tasks</span><span class="tab-badge" id="tasks-badge"></span>`,
      insights: `${icons.barChart(13)} <span class="tab-label">Insights</span>`,
      connect:  `${icons.link(13)} <span class="tab-label">Connect</span>`,
      people:   `${icons.users(13)} <span class="tab-label">People</span>`,
      settings: `${icons.settings(13)} <span class="tab-label">Settings</span>`,
    };
    tabBar.querySelectorAll('.main-tab').forEach(btn => {
      const tabId = btn.dataset.tab;
      if (tabLabels[tabId]) btn.innerHTML = tabLabels[tabId];
    });

    // Populate task badge count asynchronously
    this._updateTaskBadge();

    tabBar.addEventListener('click', (e) => {
      const tab = e.target.closest('.main-tab');
      if (!tab) return;
      const which = tab.dataset.tab;

      // Close the recording detail view if it's open
      const detailSlot = document.getElementById('recording-detail-slot');
      if (detailSlot && detailSlot.style.display !== 'none' && detailSlot.innerHTML) {
        const backBtn = detailSlot.querySelector('#rd-back');
        if (backBtn) backBtn.click();
      }

      // Update active states
      tabBar.querySelectorAll('.main-tab').forEach(b => {
        const isActive = b === tab;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      // Show/hide panels
      document.querySelectorAll('.tab-panel').forEach(el => {
        el.style.display = el.dataset.tabPanel === which ? '' : 'none';
      });

      // Lazy-render tabs on first activation; re-render stale panels
      if (which === 'insights') {
        const slot = document.getElementById('insights-slot');
        if (slot) {
          // Re-render if the panel was never rendered or data changed since last render
          const stale = slot.dataset.renderedAt && Number(slot.dataset.renderedAt) < (this._lastRecordingTs || 0);
          if (!slot.dataset.rendered || stale) {
            slot.dataset.rendered = '1';
            slot.dataset.renderedAt = String(Date.now());
            renderInsightsPanel(slot).catch(() => {});
          }
        }
      } else if (which === 'tasks') {
        const slot = document.getElementById('tasks-global-slot');
        if (slot) {
          const stale = slot.dataset.renderedAt && Number(slot.dataset.renderedAt) < (this._lastRecordingTs || 0);
          if (!slot.dataset.rendered || stale) {
            slot.dataset.rendered = '1';
            slot.dataset.renderedAt = String(Date.now());
            import('./global-tasks-panel.js').then(m => m.renderGlobalTasksPanel(slot)).catch(() => {});
          }
        }
        // Always refresh badge count when visiting tasks tab
        this._updateTaskBadge();
      } else if (which === 'connect') {
        const slot = document.getElementById('connect-slot');
        if (slot && !slot.dataset.rendered) {
          slot.dataset.rendered = '1';
          renderConnectInline(slot).catch(() => {});
        }
      } else if (which === 'settings') {
        const slot = document.getElementById('settings-slot');
        if (slot && !slot.dataset.rendered) {
          slot.dataset.rendered = '1';
          renderSettingsInline(slot);
          this._refreshShortcuts();
        }
      } else if (which === 'people') {
        const slot = document.getElementById('people-slot');
        if (slot && !slot.dataset.rendered) {
          slot.dataset.rendered = '1';
          import('./contacts-panel.js').then(m => m.renderContactsPanel(slot)).catch(() => {});
        }
      }
    });

    // Arrow-key navigation between tabs (ARIA tablist pattern)
    tabBar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tabs = [...tabBar.querySelectorAll('.main-tab')];
      const idx = tabs.indexOf(document.activeElement);
      if (idx < 0) return;
      e.preventDefault();
      const next = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      tabs[next].click();
    });
  }

  _setupKeyboard() {
    setupKeyboardShortcuts({
      sm: this.sm,
      States,
      getShortcuts: () => this._shortcuts,
      focusAskInput,
      openCommandBar,
      openSettings: openSettingsModal,
      onStart: () => this._handleStart(),
      onPause: () => this._handlePause(),
      onResume: () => this._handleResume(),
      onStop: () => this._handleStop(),
    });

    // Refresh all settings when this tab regains focus (keeps API keys, shortcuts in sync across tabs).
    window.addEventListener('focus', () => initSettings().catch(() => {}).then(() => this._refreshShortcuts()));

    // Re-render history panel when vault sync imports recordings from cloud (cross-device)
    window.addEventListener(VAULT_SYNC_COMPLETE, () => {
      const histSlot = document.getElementById('history-slot');
      if (histSlot) renderHistoryPanel(histSlot, this._shortcuts);
    });
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
      'transition:opacity 0.3s ease;',
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

    // Auto-dismiss after 30s to avoid blocking UI on small viewports
    const autoDismiss = setTimeout(() => {
      if (banner.isConnected) {
        banner.style.opacity = '0';
        setTimeout(() => banner.remove(), 300);
      }
    }, 30000);

    banner.querySelector('#install-btn').addEventListener('click', async () => {
      clearTimeout(autoDismiss);
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
      clearTimeout(autoDismiss);
      try { localStorage.setItem('takus_install_dismissed', '1'); } catch {}
      banner.remove();
    });
  }

  _setupBeforeUnload() {
    window.addEventListener('beforeunload', (e) => {
      if (this.sm.is(States.RECORDING, States.PAUSED, States.UPLOADING, States.REVIEWING, States.PROCESSING)) {
        e.preventDefault();
        // Chrome/Firefox require returnValue for the prompt to actually appear.
        // The string value is ignored by modern browsers but must be set.
        e.returnValue = '';
      }
    });
  }
}

// _openShortcutsOverlay has been extracted to src/lib/keyboard-manager.js

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

/**
 * Extract a short title from AI-generated summary markdown.
 * Strategy: take the first heading (# Title), or the first non-empty line.
 * Falls back to a type-based timestamp title.
 */
// _extractTitleFromSummary has been extracted to src/lib/recording-pipeline.js

/**
 * Extract duration in seconds from a video/audio blob.
 * Uses a temporary media element and loadedmetadata event.
 * Times out after 5s to avoid blocking the pipeline.
 */
function _extractDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement(blob.type?.startsWith('audio') ? 'audio' : 'video');
    el.preload = 'metadata';
    el.muted = true;

    const cleanup = () => {
      el.src = '';
      el.load();
      URL.revokeObjectURL(url);
    };

    el.addEventListener('loadedmetadata', () => {
      const dur = isFinite(el.duration) ? Math.round(el.duration) : 0;
      cleanup();
      resolve(dur);
    });

    el.addEventListener('error', () => { cleanup(); resolve(0); });

    // Timeout: don't block pipeline for corrupt files
    setTimeout(() => { cleanup(); resolve(0); }, 5000);

    el.src = url;
  });
}
