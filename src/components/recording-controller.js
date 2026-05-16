// Takus — Recording Controller (Phase 29: AppShell Thinning)
// Extracted from AppShell to isolate recording-specific lifecycle logic.
// The AppShell delegates recording start/pause/resume/stop/approve/upload
// to this controller, keeping the shell focused on routing and orchestration.
//
// Platform-agnostic: this module works with any state machine and recorder instance.

import { States } from '../lib/state-machine.js';
import { MS_PER_HOUR } from '../lib/utils.js';
import { generateFilename, formatDuration, formatSize, extractDuration } from '../lib/recorder.js';
import { saveRecording, saveRecoveryChunk, clearRecoveryData } from '../lib/storage.js';
import { updateRecorderStats } from './recorder-panel.js';
import { updateHeaderRecTime } from './header.js';
import { getSettings, getShortcuts } from './settings-panel.js';
import { getConfig } from '../lib/config.js';
import { showPreview, hidePreview, startAudioMeter, stopAudioMeter } from './preview-canvas.js';
import { updateProcessingPhase } from './upload-progress.js';
import { createHistoryEntry, finalizeRecording } from '../lib/recording-pipeline.js';
import { downloadLocal, downloadMP4, downloadGIF, uploadToCloud } from '../lib/upload-manager.js';
import { preloadFFmpeg } from '../lib/ffmpeg-engine.js';
import { renderSharePanel } from './share-panel.js';
import { getSelectedType, cleanupSessionConfig } from './session-config.js';
import { Observer } from '../lib/observer.js';
import { toast } from './toast.js';

/**
 * RecordingController — owns the recording lifecycle.
 * AppShell creates one of these and delegates recording actions to it.
 *
 * @param {object} deps - Dependencies injected by AppShell
 * @param {import('../lib/state-machine.js').StateMachine} deps.sm
 * @param {import('../lib/recorder.js').Recorder} deps.recorder
 * @param {import('../lib/facecam.js').FacecamManager} deps.facecam
 * @param {import('../lib/cloud-provider.js').CloudProviderManager} deps.cpm
 * @param {function} deps.render - AppShell.render() callback
 * @param {function} deps.onPostProcess - Callback after AI processing completes
 * @param {function} deps.updateTaskBadge - Callback to refresh task badge
 * @param {function} deps.setRecordingFavicon
 * @param {function} deps.resetFavicon
 */
export class RecordingController {
  constructor(deps) {
    this.sm = deps.sm;
    this.recorder = deps.recorder;
    this.facecam = deps.facecam;
    this.cpm = deps.cpm;
    this._render = deps.render;
    this._onPostProcess = deps.onPostProcess;
    this._updateTaskBadge = deps.updateTaskBadge;
    this._setRecordingFavicon = deps.setRecordingFavicon;
    this._resetFavicon = deps.resetFavicon;

    // Recording state
    this._lastBlob = null;
    this._lastFilename = '';
    this._uploadState = { loaded: 0, total: 0, link: '', error: '', participants: [] };
    this._lastHistoryEntry = null;
    this._pendingTitle = '';
    this._recordingStartTime = null;
    this._startLock = false;
    this._fiftyMinWarned = false;
    this._observer = new Observer();
    this._observerLog = null;
    this._recordingType = null;
    this._recoveryId = null;
    this._recoveryInterval = null;
    this._uploadDone = null;
  }

  // ── Accessors (for AppShell render) ──────────────────────────────────

  get lastBlob() { return this._lastBlob; }
  get lastFilename() { return this._lastFilename; }
  get uploadState() { return this._uploadState; }
  get lastHistoryEntry() { return this._lastHistoryEntry; }
  get recordingType() { return this._recordingType; }
  get recordingStartTime() { return this._recordingStartTime; }
  get pendingTitle() { return this._pendingTitle; }

  // ── Lifecycle ────────────────────────────────────────────────────────

  async handleStart() {
    if (this.sm.state === States.IDLE) {
      if (this._startLock) return;
      this._startLock = true;

      if (!this._recordingType) {
        this._recordingType = getSelectedType();
      }

      this._pendingTitle = '';
      this.sm.transition(States.REQUESTING_ACCESS);
      try {
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
        console.error('[RecCtrl] Stream request failed:', e);
        const reason = e?.name === 'NotAllowedError' ? 'Permission denied' : (e?.message || 'Could not access screen');
        toast.error('Access denied', reason);
        this.recorder.cleanup();
        this.sm.transition(States.IDLE);
        this._startLock = false;
      }
    } else if (this.sm.state === States.PREVIEWING) {
      if (this._startLock) return;
      this._startLock = true;

      const settings = getSettings();
      this.recorder.onTick((elapsed, size) => {
        updateRecorderStats(elapsed, size);
        updateHeaderRecTime(elapsed);
        const s = Math.floor(elapsed / 1000) % 60;
        const m = Math.floor(elapsed / 60000) % 60;
        const h = Math.floor(elapsed / MS_PER_HOUR);
        document.title = `⏺ ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} — Takus`;
        if (elapsed >= 3_000_000 && !this._fiftyMinWarned && this.sm.is(States.RECORDING)) {
          this._fiftyMinWarned = true;
          toast.warning('10 minutes remaining', 'Recording auto-stops at 60 minutes. Finish up soon.');
        }
        if (elapsed >= 3_600_000 && this.sm.is(States.RECORDING)) {
          toast.warning('Time limit reached', 'Recording auto-stopped at 60 minutes.');
          this.handleStop();
        }
      });
      this.recorder.onStop((blob) => {
        if (this._recoveryInterval) { clearInterval(this._recoveryInterval); this._recoveryInterval = null; }
        this._observerLog = this._observer.stop();
        stopAudioMeter();
        this.facecam.stop();

        if (!blob || blob.size < 1024) {
          console.warn('[RecCtrl] Recording too short or empty:', blob?.size, 'bytes');
          toast.warning('Recording too short', 'Please record for at least a few seconds.');
          this.recorder.cleanup();
          hidePreview();
          this.sm.transition(States.IDLE);
          return;
        }
        this._lastBlob = blob;
        this.sm.transition(States.REVIEWING);
        preloadFFmpeg();
        clearRecoveryData('active_recording').catch(() => {});
      });
      this.recorder.onError((err) => { toast.error('Recording error', err?.message || 'Recording failed'); });

      await this.showCountdown();

      if (this.sm.state !== States.PREVIEWING) {
        this._startLock = false;
        return;
      }

      try {
        this.recorder.start(settings.videoQuality, settings.audioQuality);
      } catch (e) {
        console.error('[RecCtrl] Recorder.start failed:', e);
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

      this._observerLog = null;
      this._observer.start();

      this._recoveryId = 'active_recording';
      this._recoveryInterval = setInterval(() => {
        if (this.recorder.chunks.length > 0) {
          saveRecoveryChunk(this._recoveryId, [...this.recorder.chunks]).catch(() => {});
        }
      }, 10_000);
      const shortcuts = getShortcuts ? await getShortcuts().catch(() => ({})) : {};
      const stopKeyHint = (shortcuts.stop || 's').toUpperCase();
      toast.info('Recording started', `Press ${stopKeyHint} to stop`);
    }
  }

  handlePause() {
    this.recorder.pause();
    stopAudioMeter();
    this._resetFavicon();
    document.title = '⏸ Paused — Takus';
    this.sm.transition(States.PAUSED);
  }

  handleResume() {
    this.recorder.resume();
    this.sm.transition(States.RECORDING);
    this._setRecordingFavicon();
    startAudioMeter(this.recorder);
  }

  handleStop() {
    if (this.sm.state === States.PREVIEWING) {
      this.recorder.cleanup();
      hidePreview();
      this.facecam.stop();
      if (this._recoveryInterval) { clearInterval(this._recoveryInterval); this._recoveryInterval = null; }
      this.sm.transition(States.IDLE);
      return;
    }
    this.recorder.stop();
  }

  async onRecordingApproved(blob) {
    const cfg = getConfig();

    let duration = this.recorder.elapsed;
    if (!duration || duration <= 0) {
      duration = await extractDuration(blob).catch(() => 0);
    }

    const historyEntry = createHistoryEntry({
      title: this._pendingTitle || undefined,
      type: this._recordingType || 'screen',
      duration,
      size: blob.size,
      observerLog: this._observerLog || null,
    });

    this._lastFilename = generateFilename(cfg.drive.fileNamePattern, historyEntry.title) + '.webm';
    this.recorder.cleanup();

    let resolveUpload;
    this._uploadDone = new Promise((r) => { resolveUpload = r; });

    const { processedBlob } = await finalizeRecording(blob, historyEntry, {
      watermarkText: getSettings().watermarkText || '',
      onPhase: (label, pct, sub) => updateProcessingPhase(label, pct, sub),
      processOptions: {
        recordingType: this._recordingType,
        getCloudProvider: () => this.cpm.getProvider(),
        uploadDone: this._uploadDone,
        onPhase: (label, pct, sub) => updateProcessingPhase(label, pct, sub),
        onComplete: () => this._onPostProcess(),
      },
    });
    this._lastRecordingTs = Date.now();

    const provider = this.cpm.getProvider();
    if (provider && provider.auth.isConnected) {
      this._lastBlob = processedBlob;
      try {
        await this.doUpload(historyEntry);
      } finally {
        resolveUpload();
      }
    } else {
      this._lastBlob = processedBlob;
      this.downloadLocal();
      resolveUpload();
      this.reset();
      toast.success('Recording saved', 'Downloaded to your computer');
    }
  }

  async doUpload(historyEntry) {
    if (!this._lastBlob) return;
    if (historyEntry) this._lastHistoryEntry = historyEntry;

    this._uploadState = { loaded: 0, total: this._lastBlob.size, link: '', error: '', participants: this._uploadState.participants || [] };
    this.sm.transition(States.UPLOADING);

    try {
      const provider = this.cpm.getProvider();
      const result = await uploadToCloud(
        {
          blob: this._lastBlob,
          filename: this._lastFilename,
          historyEntry,
          provider,
          context: {
            recordingType: this._recordingType,
            recordingStartTime: this._recordingStartTime,
          },
        },
        {
          onProgress: (loaded, total) => {
            this._uploadState.loaded = loaded;
            this._uploadState.total = total;
            const root = document.getElementById('main');
            const fill = root?.querySelector('.progress-fill');
            const stats = root?.querySelector('.upload-stats');
            if (fill) fill.style.width = `${Math.round((loaded/total)*100)}%`;
            if (stats) stats.innerHTML = `<span>${formatSize(loaded)} / ${formatSize(total)}</span><span>${Math.round((loaded/total)*100)}%</span>`;
          },
          onCalendarLinked: (event, attendees) => {
            toast.success('Calendar updated', `Added to "${event.summary}"`);
            if (attendees?.length) this._uploadState.participants = attendees;
          },
        }
      );

      this._uploadState.link = result.link;
      this.sm.transition(States.COMPLETE);
      toast.success('Upload complete', `Recording saved to ${provider.name}`);
      this._updateTaskBadge();

      if (result.link) {
        toast.success('Link copied', 'Copied to clipboard automatically.');
      }

    } catch (e) {
      console.error('[RecCtrl] Upload failed:', e);
      if (this._lastHistoryEntry) {
        await saveRecording(this._lastHistoryEntry).catch(() => {});
      }
      this._uploadState.error = e.message;
      this.sm.transition(States.UPLOAD_FAILED);
      toast.error('Upload failed', e.message);
    }
  }

  downloadLocal() { downloadLocal(this._lastBlob, this._lastFilename); }
  downloadMP4()   { downloadMP4(this._lastBlob, this._lastFilename); }
  downloadGIF()   { downloadGIF(this._lastBlob, this._lastFilename); }

  handleFileSelected(file) {
    if (!file) return;
    toast.success('File loaded', `Processing "${file.name}" (${formatSize(file.size)})`);
    this._recordingType = getSelectedType();
    this._pendingTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    this._lastBlob = file;
    this._recordingStartTime = Date.now();
    this.sm.transition(States.REVIEWING);
    this._render();
  }

  handleScreenshot() {
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

  handleShare(participants) {
    renderSharePanel({
      participants,
      recordingTitle: this._pendingTitle,
      driveLink: this._uploadState.link,
      aiSummary: this._lastHistoryEntry?.aiSummary || '',
    });
  }

  async toggleFacecam() {
    try {
      await this.facecam.toggle();
      this._render();
    } catch (e) {
      toast.error('Camera error', e.message || 'Could not access webcam.');
    }
  }

  showCountdown() {
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

  reset() {
    this._lastBlob = null;
    this._lastFilename = '';
    this._uploadState = { loaded: 0, total: 0, link: '', error: '', participants: [] };
    this._lastHistoryEntry = null;
    this._startLock = false;
    this._fiftyMinWarned = false;
    this._recordingType = null;
    this._observer.stop();
    this._observerLog = null;
    document.getElementById('share-overlay')?.remove();
    document.getElementById('type-picker-overlay')?.remove();
    cleanupSessionConfig();
    this.facecam.stop();
    this._resetFavicon();
    document.title = 'Takus — Knowledge OS';
    this.sm.reset();
  }
}
