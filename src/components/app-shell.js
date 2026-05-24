// Takus — App Shell (state router + orchestrator)
import { States } from '../lib/state-machine.js';
import { Recorder } from '../lib/recorder.js';
import { FacecamManager } from '../lib/facecam.js';
import { CloudProviderManager } from '../lib/cloud-provider.js';
import { isMicrosoftConfigured } from '../lib/config.js';
// Storage accessed via CaptureController/RecoveryManager — no direct imports
import { renderHeader } from './header.js';
import { renderRecorderPanel } from './recorder-panel.js';
import { renderPreviewCanvas, showPreview, startAudioMeter } from './preview-canvas.js';
import { initSettings, getShortcuts, openSettingsModal } from './settings-panel.js';
// session-config accessed via dynamic import in _renderFallbackConfig
import { icons } from '../lib/icons.js';
import { renderHistoryPanel } from './history-panel.js';
import { renderReviewPanel } from './review-panel.js';
import { renderConsentNotice } from './consent-notice.js';
import { renderUploadProgress } from './upload-progress.js';
// renderSharePanel used by CaptureController

import { toast } from './toast.js';
// extractAudio, preloadFFmpeg, downloadLocal, downloadMP4, downloadGIF, uploadToCloud,
// createEntry, finalizeCapture, Observer — all owned by CaptureController
// renderSharePanel, renderConnectInline used by CaptureController
// ask-panel — lazy-loaded (only rendered in Ask tab)
// focusAskInput exposed via dynamic wrapper for keyboard shortcuts
import { openCommandBar } from './command-bar.js';
import { renderInsightsPanel } from './insights-panel.js';
import { setupKeyboardShortcuts } from '../lib/keyboard-manager.js';
import { initDragDrop } from '../lib/drag-drop-handler.js';
import { startClosenessWorker } from '../lib/closeness-worker.js';
// autonomy-engine — lazy-loaded (only started after initial render)
// (isTaskPending moved to task-store — badge counting done via task store)
import { getNavItems as _getNavItems, getQuickActions as _getQuickActions } from '../lib/app-manager.js';
import { OPEN_ENTRY, DATE_FILTER, VAULT_SYNC_COMPLETE, AUTO_RECORD_PENDING, NOTIFY, START_RECORDING, FILE_SELECTED, STORAGE_ERROR } from '../lib/events.js';
import { showAutoRecordNotification } from './auto-record-notification.js';
import { isEnabled } from '../lib/feature-flags.js';
import { CaptureController } from './capture-controller.js';
import { checkRecovery } from './recovery-manager.js';
import { buildTabBarHTML, initMainTabs, lazyRenderTab } from './tab-manager.js';
import { renderSidebar, setActiveItem, isSidebarCollapsed } from './sidebar.js';
import { renderHomeDashboard } from './home-dashboard.js';
import { initFloatingCapture, floatingCaptureStarted, floatingCaptureStopped, floatingCapturePaused } from './floating-capture-bar.js';

export class AppShell {
  constructor(rootEl, stateMachine) {
    this.root = rootEl;
    this.sm = stateMachine;
    this.recorder = new Recorder();
    this.facecam = new FacecamManager();
    this.cpm = CloudProviderManager.getInstance();
    this._shortcuts = { record: 'r', pause: ' ', stop: 's' };
    this._activeTabId = 'home'; // default active tab — home dashboard
    this._activeEntry = null;

    // Capture Controller — owns lifecycle
    this._rc = new CaptureController({
      sm: this.sm,
      recorder: this.recorder,
      facecam: this.facecam,
      cpm: this.cpm,
      render: () => this.render(),
      onPostProcess: () => {
        if (this.sm.is(States.IDLE)) {
          renderHistoryPanel(document.getElementById('history-slot'));
          const askSlot = document.getElementById('ask-slot');
          if (askSlot) import('./ask-panel.js').then(m => m.renderAskPanel(askSlot)).catch(() => {});
          const insSlot = document.getElementById('insights-slot');
          if (insSlot?.dataset.rendered) {
            renderInsightsPanel(insSlot).catch(() => {});
          }
        }
      },
      updateTaskBadge: () => this._updateTaskBadge(),
      setRecordingFavicon: () => this._setRecordingFavicon(),
      resetFavicon: () => this._resetFavicon(),
    });

    this._installPrompt = null;
    this._originalFavicon = null;
    this.sm.onTransition(() => this.render());
    // Re-render when user manually closes PiP window so camera button icon updates
    this.facecam._onDeactivate = () => this.render();
    this._setupKeyboard();
    this._setupBeforeUnload();
    this._setupQuickActionListener();

    // Listen for sidebar collapse/expand to update layout grid
    document.addEventListener('takus:sidebar-toggle', () => {
      const layout = document.querySelector('.app-layout');
      if (layout) layout.classList.toggle('sidebar-collapsed', isSidebarCollapsed());
    });

    // Dismiss mobile sidebar when clicking outside
    document.addEventListener('click', (e) => {
      const layout = document.querySelector('.app-layout');
      if (layout && layout.classList.contains('sidebar-mobile-open')) {
        const sidebarSlot = document.getElementById('sidebar-slot');
        const menuBtn = document.getElementById('header-menu-btn');
        if (sidebarSlot && !sidebarSlot.contains(e.target) && menuBtn && !menuBtn.contains(e.target)) {
          layout.classList.remove('sidebar-mobile-open');
        }
      }
    });

    // Re-render when active apps change
    window.addEventListener('takus:apps-changed', (e) => {
      const { appId, active } = e.detail || {};
      if (!active && this._activeTabId === appId) {
        this._activeTabId = 'home';
      }
      if (this.sm.is(States.IDLE)) {
        this._lastRenderedState = null;
        this.render();
        this._initMainTabs();
      }
    });
  }

  async init() {
    // PWA install prompt — defer and show a banner after the first user interaction
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._installPrompt = e;
      this._showInstallBanner();
    });

    // Pre-load all settings into the in-memory cache before first render
    await initSettings().catch(e => console.warn('[AppShell] Settings init failed:', e.message));
    // Initialize workspace cache (must run before first render so getWorkspaceCached() works)
    try { const { initWorkspace } = await import('../lib/workspace.js'); await initWorkspace(); } catch { /* workspace module optional */ }
    try { this._shortcuts = await getShortcuts(); } catch { /* non-critical */ }

    // If launched via a PWA shortcut with ?type=X, pre-set the content type so
    // the picker is skipped and the user lands directly in the entry flow.
    const launchType = new URLSearchParams(window.location.search).get('type');
    const validTypes = ['meeting', 'screen', 'presentation', 'update'];
    if (launchType && validTypes.includes(launchType)) {
      this._contentType = launchType;
      history.replaceState(null, '', window.location.pathname);
    }

    // First-run setup wizard — show before the main app renders
    try {
      const { isSetupComplete, showSetupWizard } = await import('./setup-wizard.js');
      if (!(await isSetupComplete())) {
        await showSetupWizard();
      }
    } catch {
      toast.warning('Setup skipped', 'Open Settings (⌘,) to configure your AI provider and cloud storage.');
    }

    this.render();

    // Start background closeness score recomputation (runs every 24h)
    startClosenessWorker();

    // Start the autonomy engine — background intelligence loop
    import('../lib/autonomy-engine.js').then(async ({ startAutonomy, onAutonomyEvent }) => {
      startAutonomy();
      const { notifyEphemeral } = await import('../lib/notification-manager.js');
      onAutonomyEvent((type, data) => {
        if (type === 'embed_complete') {
          notifyEphemeral('Knowledge indexed', `Transcript embedded (${data.chunks} chunks)`, 'info');
        } else if (type === 'closeness_recomputed' && data.crossed?.length > 0) {
          notifyEphemeral('Relationships updated', `${data.crossed.length} contact${data.crossed.length > 1 ? 's' : ''} crossed threshold`, 'info');
        }
      });
    }).catch(() => {});

    // Start well-being session tracking
    import('../lib/wellbeing.js').then(({ startSession }) => startSession()).catch(() => {});

    // Bridge: notification-manager (lib/) → toast.js (component/)
    // All lib modules emit NOTIFY events via notification-manager;
    // this listener is the single point that renders them as visible toasts.
    document.addEventListener(NOTIFY, (e) => {
      const { title, body, level } = e.detail;
      toast[level]?.(title, body) || toast.info(title, body);
    });

    document.addEventListener(STORAGE_ERROR, (e) => {
      const { type, message } = e.detail;
      toast.error(type === 'quota' ? 'Storage Full' : 'Database Error', message);
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

    // Auto-record notification: show confirmation dialog when an event is about to start
    document.addEventListener(AUTO_RECORD_PENDING, async (e) => {
      const calEvent = e.detail?.event;
      if (!calEvent) return;
      if (!await isEnabled('autoRecord')) return;
      showAutoRecordNotification(calEvent, {
        onConfirm: () => toast.info('Auto-capture', `Capture started for "${calEvent.title || 'Untitled'}"`),
        onDismiss: () => toast.info('Skipped', 'Auto-capture skipped'),
        onSuppress: () => toast.info('Suppressed', 'This event will not auto-record again'),
      });
    });

    // Entry detail drill-down: open the 70/30 detail view
    document.addEventListener(OPEN_ENTRY, async (e) => {
      if (!this.sm.is(States.IDLE)) return;
      const { entry } = e.detail;
      if (!entry) return;

      this._activeEntry = entry;
      const headerSlot = document.getElementById('header-slot');
      if (headerSlot) renderHeader(headerSlot, this.sm.state, this._activeTabId, this._activeEntry);

      // Push browser history so the back button closes the detail view
      history.pushState({view:'entry', id: entry.id}, '', '#entry/' + entry.id);

      // Hide main content area
      const elementsToHide = ['content-area', 'consent-slot'];
      elementsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      // Create detail slot if it doesn't exist
      let detailSlot = document.getElementById('entry-detail-slot');
      if (!detailSlot) {
        detailSlot = document.createElement('div');
        detailSlot.id = 'entry-detail-slot';
        document.getElementById('main')?.appendChild(detailSlot);
      }
      detailSlot.style.display = '';

      const { renderEntryDetail } = await import('./entry-detail.js');
      renderEntryDetail(detailSlot, entry, () => {
        this._activeEntry = null;
        if (headerSlot) renderHeader(headerSlot, this.sm.state, this._activeTabId, null);

        // Back handler — navigate back via browser history
        detailSlot.style.display = 'none';
        detailSlot.innerHTML = '';
        elementsToHide.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = '';
        });
        history.back();
      }, (updatedRec) => {
        // Re-render affected panels when a entry changes in detail view
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

    // Close entry detail view when the user presses browser back
    window.addEventListener('popstate', () => {
      if (this._activeEntry) {
        this._activeEntry = null;
        const headerSlot = document.getElementById('header-slot');
        if (headerSlot) renderHeader(headerSlot, this.sm.state, this._activeTabId, null);
        const detailSlot = document.getElementById('entry-detail-slot');
        if (detailSlot) { detailSlot.style.display = 'none'; detailSlot.innerHTML = ''; }
        ['content-area', 'consent-slot'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = '';
        });
      }
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
   * Delegated to RecoveryManager.
   */
  async _checkRecovery() {
    await checkRecovery({
      sm: this.sm,
      States,
      onResumeBlob: (blob, title) => {
        this._lastBlob = blob;
        this._pendingTitle = title;
        this._contentType = null;
        this.sm.transition(States.REVIEWING);
        this.render();
      },
    });
  }

  async _refreshShortcuts() {
    try { this._shortcuts = await getShortcuts(); } catch { /* non-critical */ }
  }

  /** Update the pending-tasks badge on the Tasks tab */
  async _updateTaskBadge() {
    // Debounce: skip if another update is already in-flight
    if (this._taskBadgeInFlight) return;
    this._taskBadgeInFlight = true;
    try {
      // Use the unified task store — covers both embedded and standalone node tasks
      const { getTaskCounts } = await import('../lib/graph/task-store.js');
      const counts = await getTaskCounts();
      const pending = counts.pending;
      // Only touch DOM if the value actually changed
      if (this._cachedPendingCount !== pending) {
        this._cachedPendingCount = pending;
        const badge = document.getElementById('tasks-badge');
        if (badge) {
          badge.textContent = pending > 0 ? (pending > 99 ? '99+' : String(pending)) : '';
          badge.style.display = pending > 0 ? '' : 'none';
        }
        const mobileBadge = document.getElementById('mobile-tasks-badge');
        if (mobileBadge) {
          mobileBadge.textContent = pending > 0 ? (pending > 99 ? '99+' : String(pending)) : '';
          mobileBadge.style.display = pending > 0 ? '' : 'none';
        }
      }
    } catch { /* non-critical */ } finally {
      this._taskBadgeInFlight = false;
    }

    // Update badges for all other app-contributed tabs
    for (const tab of (this._resolvedTabs || [])) {
      if (tab.id === 'tasks') continue; // already handled above
      if (typeof tab.getBadgeCount !== 'function') continue;
      const count = tab.getBadgeCount();
      const badge = document.getElementById(`${tab.id}-badge`);
      if (badge) {
        badge.textContent = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
        badge.style.display = count > 0 ? '' : 'none';
      }
    }
  }

  render() {
    const state = this.sm.state;
    const isActive = [States.RECORDING, States.PAUSED, States.PREVIEWING, States.REQUESTING_ACCESS].includes(state);
    const isPostRecord = [States.PROCESSING, States.UPLOADING, States.COMPLETE, States.UPLOAD_FAILED].includes(state);

    // Notify floating capture bar of state changes
    if (state === States.RECORDING) floatingCaptureStarted();
    else if (state === States.PAUSED) floatingCapturePaused();
    else if (state === States.IDLE) floatingCaptureStopped();

    // ── Guard: skip full DOM rebuild if state hasn't actually changed ──
    // This preserves Ask panel typed queries, History scroll position,
    // expanded items, and all event listeners during IDLE→IDLE transitions.
    if (state === this._lastRenderedState && state === States.IDLE) {
      // Just refresh the header (recording indicator, workspace badge)
      const headerSlot = document.getElementById('header-slot');
      if (headerSlot) renderHeader(headerSlot, state, this._activeTabId, this._activeEntry);
      return;
    }
    this._lastRenderedState = state;

    // Cinematic Mode Toggle + Tab title
    if (state === States.RECORDING || state === States.PAUSED) {
      document.body.classList.add('cinematic-mode');
    } else {
      document.body.classList.remove('cinematic-mode');
      document.title = 'Takus — Knowledge OS';
    }

    this.root.innerHTML = `
      <div class="app-layout${state === States.IDLE ? (isSidebarCollapsed() ? ' sidebar-collapsed' : '') : ' no-sidebar'}">
        ${state === States.IDLE ? '<div id="sidebar-slot"></div>' : ''}
        <div class="app-main">
          <div id="header-slot"></div>
          <main class="main-content" id="main">
            ${isActive ? '<div id="preview-slot"></div>' : ''}
            ${state === States.REVIEWING ? '<div id="review-slot"></div>' : ''}
            ${isPostRecord ? '<div id="upload-slot"></div>' : ''}
            
            ${state === States.IDLE ? `
              <div id="consent-slot"></div>
              <div id="content-area" style="flex:1;overflow-y:auto;">
                <div id="home-slot" style="${this._activeTabId !== 'home' ? 'display:none;' : ''}"></div>
                ${this._buildTabBarHTML()}
              </div>
            ` : `
              <div id="recorder-slot"></div>
            `}
          </main>
        </div>
      </div>
    `;

    // Render sub-components
    renderHeader(document.getElementById('header-slot'), state, this._activeTabId, this._activeEntry);

    if (state === States.IDLE) {
      renderConsentNotice(document.getElementById('consent-slot'));

      // Render sidebar navigation
      const sidebarSlot = document.getElementById('sidebar-slot');
      if (sidebarSlot) {
        renderSidebar(sidebarSlot, {
          activeId: this._activeTabId,
          onNavigate: (id) => this._handleSidebarNav(id),
        });
      }

      // Render home dashboard (default landing)
      const homeSlot = document.getElementById('home-slot');
      if (homeSlot && this._activeTabId === 'home') {
        renderHomeDashboard(homeSlot, {
          onNavigate: (id) => this._handleSidebarNav(id),
          onStartCapture: () => this._handleStart(),
        }).catch(() => {});
      }

      // Lazy-render the active tab panel (if not home)
      if (this._activeTabId !== 'home') {
        this._lazyRenderTab(this._activeTabId);
      }

      // Initialize floating capture bar
      initFloatingCapture({
        onStartCapture: (type) => {
          this._contentType = type;
          this._handleStart();
        },
        onPause: () => this._handlePause(),
        onResume: () => this._handleResume(),
        onStop: () => this._handleStop(),
      });



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
        contentType: this._contentType,
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
          entryTitle: this._pendingTitle,
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
          onRetry: () => this._doUpload(this._lastEntry),
          onDownload: () => {
            this._downloadLocal();
            toast.success('Saved locally', 'Downloaded to your computer');
            this._reset();
          },
          onDismiss: () => this._reset(),
        });
      }
    }

    // In non-IDLE states, render the recorder panel controls (pause/resume/stop).
    // In IDLE state, the floating capture bar handles quick actions.
    if (state !== States.IDLE) {
      renderRecorderPanel(document.getElementById('recorder-slot'), state, {
        isCameraActive: this.facecam.isActive,
        contentType: this._contentType,
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
  }

  // ── Sidebar Navigation ──────────────────────────────────────────────────

  /**
   * Handle sidebar navigation. Shows/hides home dashboard and tab panels.
   * @param {string} id — The sidebar item ID to navigate to
   */
  _handleSidebarNav(id) {
    this._activeTabId = id;

    // Show/hide home dashboard
    const homeSlot = document.getElementById('home-slot');
    if (homeSlot) homeSlot.style.display = id === 'home' ? '' : 'none';

    // Hide all tab panels, show the selected one
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    if (id !== 'home') {
      const panel = document.querySelector(`[data-tab-panel="${id}"]`);
      if (panel) panel.style.display = '';
      this._lazyRenderTab(id);
    } else {
      // Re-render home dashboard
      const homeEl = document.getElementById('home-slot');
      if (homeEl) {
        renderHomeDashboard(homeEl, {
          onNavigate: (navId) => this._handleSidebarNav(navId),
          onStartCapture: () => this._handleStart(),
        }).catch(() => {});
      }
    }

    setActiveItem(id);

    // Update sidebar-collapsed class on layout
    const layout = document.querySelector('.app-layout');
    if (layout) {
      layout.classList.toggle('sidebar-collapsed', isSidebarCollapsed());
      layout.classList.remove('sidebar-mobile-open');
    }

    const headerSlot = document.getElementById('header-slot');
    if (headerSlot) {
      renderHeader(headerSlot, this.sm.state, id, this._activeEntry);
    }
  }

  // ── Capture Lifecycle (delegated to CaptureController) ─────────────────────

  async _handleStart()         { await this._rc.handleStart(); }
  _handlePause()               { this._rc.handlePause(); }
  _handleResume()              { this._rc.handleResume(); }
  _handleStop()                { this._rc.handleStop(); }
  async _onRecordingApproved(b){ await this._rc.onRecordingApproved(b); }
  async _doUpload(entry)       { await this._rc.doUpload(entry); }
  _downloadLocal()             { this._rc.downloadLocal(); }
  _downloadMP4()               { this._rc.downloadMP4(); }
  _downloadGIF()               { this._rc.downloadGIF(); }
  _handleScreenshot()          { this._rc.handleScreenshot(); }
  _handleShare(p)              { this._rc.handleShare(p); }
  async _toggleFacecam()       { await this._rc.toggleFacecam(); }
  _showCountdown()             { return this._rc.showCountdown(); }
  _reset()                     { this._rc.reset(); }

  /**
   * Trigger the upload flow.
   * Delegates to the Drive app for file selection and validation.
   */
  async _handleUpload() {
    try {
      const { getApp } = await import('../lib/app-manager.js');
      const drive = getApp('drive');
      if (drive && typeof drive._pickAndValidateFile === 'function') {
        drive._pickAndValidateFile();
        return;
      }
    } catch { /* non-critical */ }
    toast.error('Upload unavailable', 'Drive app is not active.');
  }

  /**
   * Handle a validated file from the Drive app (or drag-drop).
   * @param {File} file - Pre-validated media file
   */
  _handleFileSelected(file) {
    this._rc.handleFileSelected(file);
  }

  /** Global drag-and-drop file upload */
  _initDragDrop() {
    this._cleanupDragDrop = initDragDrop({
      sm: this.sm,
      States,
      onFileDrop: (file) => this._handleFileSelected(file),
    });
  }

  // State proxies — render() reads these from _rc
  get _lastBlob()              { return this._rc.lastBlob; }
  set _lastBlob(v)             { this._rc._lastBlob = v; }
  get _lastFilename()          { return this._rc.lastFilename; }
  set _lastFilename(v)         { this._rc._lastFilename = v; }
  get _uploadState()           { return this._rc.uploadState; }
  set _uploadState(v)          { this._rc._uploadState = v; }
  get _lastEntry()             { return this._rc.lastEntry; }
  set _lastEntry(v)             { this._rc._lastEntry = v; }
  get _pendingTitle()          { return this._rc.pendingTitle; }
  set _pendingTitle(v)         { this._rc._pendingTitle = v; }
  get _recordingStartTime()    { return this._rc.recordingStartTime; }
  set _recordingStartTime(v)   { this._rc._recordingStartTime = v; }
  get _contentType()         { return this._rc.contentType; }
  set _contentType(v)        { this._rc._contentType = v; }
  get _startLock()             { return this._rc._startLock; }
  set _startLock(v)            { this._rc._startLock = v; }
  get _observer()              { return this._rc._observer; }
  get _observerLog()           { return this._rc._observerLog; }
  set _observerLog(v)          { this._rc._observerLog = v; }
  get _recoveryId()            { return this._rc._recoveryId; }
  set _recoveryId(v)           { this._rc._recoveryId = v; }
  get _recoveryInterval()      { return this._rc._recoveryInterval; }
  set _recoveryInterval(v)     { this._rc._recoveryInterval = v; }
  get _fiftyMinWarned()        { return this._rc._fiftyMinWarned; }
  set _fiftyMinWarned(v)       { this._rc._fiftyMinWarned = v; }

  /**
   * Get the standard config panel callbacks.
   * Shared between app config panels and the fallback rendering.
   * @returns {object}
   */
  _getConfigCallbacks() {
    return {
      isCameraActive: this.facecam.isActive,
      onTypeChange: (typeId, preset) => {
        this._contentType = typeId;
        if (preset.camera && !this.facecam.isActive) this._toggleFacecam();
        else if (!preset.camera && this.facecam.isActive) this._toggleFacecam();
      },
      onToggleCamera: () => this._toggleFacecam(),
    };
  }

  /**
   * Render config panels contributed by active apps into the config-panel-slot.
   * Each app that implements renderConfigPanel() gets its own sub-container.
   * Currently: Recorder app renders type picker + camera/mic.
   *
   * @param {HTMLElement} slot - The #config-panel-slot element
   */
  async _renderAppConfigPanels(slot) {
    const callbacks = this._getConfigCallbacks();

    try {
      const { getConfigPanelApps } = await import('../lib/app-manager.js');
      const apps = getConfigPanelApps();

      if (!apps.length) {
        await this._renderFallbackConfig(slot, callbacks);
        return;
      }

      for (const app of apps) {
        const appSlot = document.createElement('div');
        appSlot.id = `config-panel-${app.id}`;
        slot.appendChild(appSlot);
        await app.renderConfigPanel(appSlot, callbacks);
      }
    } catch { /* non-critical */
      await this._renderFallbackConfig(slot, callbacks);
    }
  }

  /**
   * Fallback: render session-config directly when no app platform is available.
   */
  async _renderFallbackConfig(slot, callbacks) {
    const { renderSessionConfig } = await import('./session-config.js');
    await renderSessionConfig(slot, callbacks);
  }

  /**
   * Listen for domain events dispatched by app quick actions.
   * Each app dispatches its own specific event — no generic routing needed.
   *
   * Events:
   *   takus:start-recording → Start the recording flow
   *   takus:file-selected   → A validated file is ready for processing (from Drive app or drag-drop)
   */
  _setupQuickActionListener() {
    document.addEventListener(START_RECORDING, () => this._handleStart());
    document.addEventListener(FILE_SELECTED, (e) => {
      const { file } = e.detail || {};
      if (file) this._handleFileSelected(file);
    });
  }

  // ── Dynamic Tab Bar ─────────────────────────────────────────────────────

  /**
   * Build tab bar HTML and panel slots. Delegated to TabManager.
   */
  _buildTabBarHTML() {
    const result = buildTabBarHTML(_getNavItems, this._activeTabId);
    this._resolvedTabs = result.resolvedTabs;
    return result.html;
  }

  /**
   * Initialize tab interactivity. Delegated to TabManager.
   */
  _initMainTabs() {
    initMainTabs({
      resolvedTabs: this._resolvedTabs || [],
      activeTabId: this._activeTabId,
      updateTaskBadge: () => this._updateTaskBadge(),
      refreshShortcuts: () => this._refreshShortcuts(),
      onTabSwitch: (tabId) => {
        this._handleSidebarNav(tabId);
      },
      lastEntryTs: this._lastEntryTs || 0,
    });
  }

  /**
   * Lazy-render a tab panel. Delegated to TabManager.
   */
  async _lazyRenderTab(tabId) {
    await lazyRenderTab(tabId, {
      resolvedTabs: this._resolvedTabs || [],
      updateTaskBadge: () => this._updateTaskBadge(),
      refreshShortcuts: () => this._refreshShortcuts(),
      lastEntryTs: this._lastEntryTs || 0,
    });
  }

  _setupKeyboard() {
    this._cleanupKeyboard = setupKeyboardShortcuts({
      sm: this.sm,
      States,
      getShortcuts: () => this._shortcuts,
      focusAskInput: () => import('./ask-panel.js').then(m => m.focusAskInput()).catch(() => {}),
      openCommandBar,
      openSettings: openSettingsModal,
      onStart: () => this._handleStart(),
      onPause: () => this._handlePause(),
      onResume: () => this._handleResume(),
      onStop: () => this._handleStop(),
    });

    // Load shortcut registry
    import('../lib/shortcut-registry.js').then(({ loadShortcuts }) => {
      loadShortcuts().catch(e => console.warn('[AppShell] Shortcut load failed:', e.message));
    }).catch(e => console.warn('[AppShell] Keyboard shortcut init failed:', e.message));

    // Refresh all settings when this tab regains focus (keeps API keys, shortcuts in sync across tabs).
    window.addEventListener('focus', () => initSettings().catch(() => {}).then(() => this._refreshShortcuts()));

    // Re-render history panel when vault sync imports entries from cloud (cross-device)
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
        <span class="text-xs-muted">Add to home screen for quick access</span>
      </div>
      <button id="install-btn" class="btn btn-primary btn-sm">Install</button>
      <button id="install-dismiss" class="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss">${icons.x(14)}</button>
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
          try { localStorage.setItem('takus_install_dismissed', '1'); } catch { /* non-critical */ }
        }
      } catch { /* non-critical */ }
      banner.remove();
      this._installPrompt = null;
    });

    banner.querySelector('#install-dismiss').addEventListener('click', () => {
      clearTimeout(autoDismiss);
      try { localStorage.setItem('takus_install_dismissed', '1'); } catch { /* non-critical */ }
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


