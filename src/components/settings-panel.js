// Takus — Settings Panel (modal overlay)
import { icons } from '../lib/icons.js';
import { esc, timeAgo } from '../lib/utils.js';
import { getConfig } from '../lib/config.js';
// Settings persistence handled via settings-store.js (saveAndCache)
import { CloudProviderManager } from '../lib/cloud-provider.js';
import { toast } from './toast.js';
import { openConnectModal } from './connect-panel.js';
import { getAllFlags, setFlag } from '../lib/feature-flags.js';
// Extracted utilities
import {
  feedbackIcon as _feedbackIcon,
  renderAutoRuns as _renderAutoRuns,
  renderAppSettings as _renderAppSettings,
} from './settings-utils.js';

// Re-export store functions so existing consumers don't break
export { initSettings, getSettings, getShortcuts, restoreSettingsFromCloud } from '../lib/settings-store.js';
import { saveAndCache, getSettings as _getSettings } from '../lib/settings-store.js';

// ── UI helpers ────────────────────────────────────────────────────────────────

// Module-level settings snapshot — refreshed at render time.
// This provides the same _cache interface the template strings expect.
let _cache = _getSettings();

/** Refresh the local _cache from the in-memory settings store. */
function _refreshCache() { _cache = _getSettings(); }

function _saveAndCache(key, value) {
  saveAndCache(key, value, _showSaveConfirmation);
  _cache[key] = value; // Keep local snapshot in sync
}

let _saveConfirmTimer = null;
function _showSaveConfirmation() {
  const el = document.getElementById('settings-saved-indicator');
  if (!el) return;
  el.textContent = '✓ Saved';
  el.style.opacity = '1';
  clearTimeout(_saveConfirmTimer);
  _saveConfirmTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

// ── Modal entry point ─────────────────────────────────────────────────────────
export function openSettingsModal() {
  _refreshCache();
  document.getElementById('settings-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'settings-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Settings');
  overlay.style.cssText = [
    'position:fixed;inset:0;',
    'background:rgba(0,0,0,0.7);',
    'display:flex;align-items:flex-start;justify-content:center;',
    'z-index:var(--z-modal);',
    'padding:var(--space-4);',
    'overflow-y:auto;',
    'backdrop-filter:blur(6px);',
  ].join('');

  const cfg = getConfig();
  const q   = _cache.videoQuality || cfg.capture.defaultVideoQuality;
  const aq  = _cache.audioQuality || cfg.capture.defaultAudioQuality;
  const aiP = _cache.aiProvider || 'openai';
  const hasAiKey = aiP === 'gemini' ? !!_cache.geminiKey : !!_cache.openaiKey;

  overlay.innerHTML = `
    <div class="card animate-in" style="width:100%;max-width:540px;margin-top:var(--space-8);display:flex;flex-direction:column;gap:0;">
      <div class="card-header" style="position:sticky;top:0;background:var(--color-bg-surface);backdrop-filter:blur(8px);z-index:1;flex-shrink:0;">
        <h3 class="flex-center gap-2">${icons.settings(16)} Settings</h3>
        <div class="flex-center gap-3">
          <span id="settings-saved-indicator" style="font-size:var(--font-xs);color:var(--color-success);opacity:0;transition:opacity 0.3s;">✓ Saved</span>
          <button class="btn btn-ghost btn-icon btn-sm" id="settings-close" aria-label="Close">${icons.x(16)}</button>
        </div>
      </div>

      <form autocomplete="off" onsubmit="return false" style="display:flex;flex-direction:column;gap:var(--space-5);padding:var(--space-4);">

        <!-- AI Provider -->
        <div style="border:1px solid rgba(124,58,237,0.25);border-radius:var(--radius-md);padding:var(--space-4);background:rgba(124,58,237,0.05);">
          <div style="font-size:var(--font-sm);font-weight:var(--weight-bold);margin-bottom:var(--space-3);display:flex;align-items:center;gap:var(--space-2);color:var(--color-primary-light);">
            ${icons.zap(14)} AI Provider
            <span id="ai-status-pill" style="margin-left:auto;font-size:var(--font-xs);font-weight:500;color:${hasAiKey ? 'var(--color-success)' : 'var(--color-warning)'};display:flex;align-items:center;gap:4px;">
              <span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;flex-shrink:0;"></span>
              ${hasAiKey ? 'Configured' : 'No API key'}
            </span>
          </div>
          <div class="input-group" style="margin-bottom:var(--space-3);">
            <label for="setting-ai-provider">Provider</label>
            <select class="select" id="setting-ai-provider">
              <option value="openai"  ${aiP==='openai' ?'selected':''}>OpenAI — Whisper + GPT-4o-mini</option>
              <option value="gemini"  ${aiP==='gemini' ?'selected':''}>Google Gemini 2.0 Flash</option>
            </select>
          </div>
          <div id="ai-openai-section" ${aiP!=='openai'?'style="display:none"':''}>
            <div class="input-group">
              <label for="setting-openai">OpenAI API Key</label>
              <div style="display:flex;gap:var(--space-2);">
                <input class="input" type="password" id="setting-openai" value="${esc(_cache.openaiKey||'')}" placeholder="sk-…" autocomplete="off" style="flex:1;" />
                <button class="btn btn-ghost btn-sm" id="test-openai-key" type="button" title="Verify this key works">${icons.zap(14)} Test</button>
              </div>
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:4px;">
                Used for Whisper transcription and GPT-4o-mini summary. Stored locally only.
              </div>
            </div>
          </div>
          <div id="ai-gemini-section" ${aiP!=='gemini'?'style="display:none"':''}>
            <div class="input-group">
              <label for="setting-gemini">Google Gemini API Key</label>
              <div style="display:flex;gap:var(--space-2);">
                <input class="input" type="password" id="setting-gemini" value="${esc(_cache.geminiKey||'')}" placeholder="AIza…" autocomplete="off" style="flex:1;" />
                <button class="btn btn-ghost btn-sm" id="test-gemini-key" type="button" title="Verify this key works">${icons.zap(14)} Test</button>
              </div>
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:4px;">
                Gemini 2.0 Flash handles transcription and summary in one call.
                Get a free key at <span style="color:var(--color-primary-light);">aistudio.google.com</span>.
              </div>
            </div>
          </div>
        </div>

        <!-- Capture Quality -->
        <div>
          <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);margin-bottom:var(--space-3);color:var(--color-text-secondary);">Capture Quality</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);">
            <div class="input-group">
              <label for="setting-video">Video</label>
              <select class="select" id="setting-video">
                <option value="480p"  ${q==='480p' ?'selected':''}>480p SD</option>
                <option value="720p"  ${q==='720p' ?'selected':''}>720p HD</option>
                <option value="1080p" ${q==='1080p'?'selected':''}>1080p FHD</option>
              </select>
            </div>
            <div class="input-group">
              <label for="setting-audio">Audio</label>
              <select class="select" id="setting-audio">
                <option value="low"    ${aq==='low'   ?'selected':''}>64 kbps</option>
                <option value="medium" ${aq==='medium'?'selected':''}>96 kbps</option>
                <option value="high"   ${aq==='high'  ?'selected':''}>128 kbps</option>
              </select>
            </div>
          </div>
          <div id="size-estimate" style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:var(--space-2);"></div>
        </div>

        <!-- Watermark + Auto-copy -->
        <div style="display:flex;flex-direction:column;gap:var(--space-3);">
          <div class="input-group">
            <label for="setting-watermark">Video Watermark (Optional)</label>
            <input class="input" type="text" id="setting-watermark" value="${esc(_cache.watermarkText||'')}" placeholder="e.g. Confidential" autocomplete="off" maxlength="120" />
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);">Burns text into the video during export.</div>
              <div id="watermark-count" style="font-size:10px;color:var(--color-text-disabled);">${(_cache.watermarkText||'').length}/120</div>
            </div>
          </div>
          <div class="input-group" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" id="setting-autocopy" ${_cache.autoCopyLink!==false?'checked':''} />
            <label for="setting-autocopy" style="margin:0;">Auto-copy link after upload</label>
          </div>
          <div class="input-group" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" id="setting-notifications" ${_cache.desktopNotifications?'checked':''} ${typeof Notification === 'undefined' ? 'disabled' : ''} />
            <label for="setting-notifications" style="margin:0;">${icons.bell(12)} Desktop notifications when AI finishes</label>
          </div>
        </div>

        <!-- Keyboard Shortcuts -->
        <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:var(--space-4);">
          <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);margin-bottom:var(--space-3);color:var(--color-text-secondary);">Keyboard Shortcuts</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-2);">
            <div class="input-group">
              <label for="shortcut-record" style="font-size:var(--font-xs);">Record</label>
              <input class="input" type="text" id="shortcut-record" value="${_cache.shortcutRecord||'r'}" maxlength="1" style="text-align:center;" autocomplete="off" />
            </div>
            <div class="input-group">
              <label for="shortcut-pause" style="font-size:var(--font-xs);">Pause</label>
              <input class="input" type="text" id="shortcut-pause" value="${(_cache.shortcutPause||' ')===' '?'Space':(_cache.shortcutPause||' ')}" maxlength="5" style="text-align:center;" autocomplete="off" />
            </div>
            <div class="input-group">
              <label for="shortcut-stop" style="font-size:var(--font-xs);">Stop</label>
              <input class="input" type="text" id="shortcut-stop" value="${_cache.shortcutStop||'s'}" maxlength="1" style="text-align:center;" autocomplete="off" />
            </div>
          </div>
        </div>

        <!-- Cloud Sync -->
        <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:var(--space-4);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);">Cloud Sync</div>
              <div id="cloud-sync-status" style="font-size:var(--font-xs);color:var(--color-text-muted);"></div>
            </div>
          </div>
          <div style="font-size:10px;color:var(--color-text-disabled);margin-top:var(--space-2);">
            ${icons.shield(10)} API keys are stored locally and never synced to the cloud.
          </div>
        </div>

        <!-- Connect integrations -->
        <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:var(--space-4);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);display:flex;align-items:center;gap:var(--space-2);">${icons.link(14)} Connect integrations</div>
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);">Route tasks to Slack, GitHub, and Linear</div>
            </div>
            <button class="btn btn-ghost btn-sm" id="btn-open-connect">${icons.arrowRight(14)} Configure</button>
          </div>
        </div>

        <!-- Feedback & Diagnostics -->
        <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:var(--space-4);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);display:flex;align-items:center;gap:var(--space-2);">${icons.flag(14)} Feedback & Diagnostics</div>
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);">Report bugs, suggest features, or view past submissions</div>
            </div>
            <button class="btn btn-ghost btn-sm" id="btn-open-feedback">${icons.send(14)} New</button>
          </div>
          <div id="feedback-history-slot" style="margin-top:var(--space-3);"></div>
        </div>

      </form>
    </div>`;

  document.body.appendChild(overlay);

  const closeModal = () => {
    overlay.remove();
    document.removeEventListener('keydown', escHandler);
  };
  const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', escHandler);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('#settings-close').addEventListener('click', closeModal);

  // Shared settings event binding (AI provider, keys, quality, watermark, shortcuts, cloud sync)
  _bindSettingsEvents(overlay, cfg);

  // ── Modal-specific handlers ────────────────────────────────────────────
  overlay.querySelector('#btn-open-connect')?.addEventListener('click', () => {
    closeModal();
    setTimeout(openConnectModal, 100);
  });

  overlay.querySelector('#btn-open-feedback')?.addEventListener('click', () => {
    closeModal();
    setTimeout(() => {
      import('./feedback-modal.js').then(m => m.openFeedbackModal()).catch(() => {});
    }, 100);
  });
  // Render feedback history into slot
  import('../lib/feedback-engine.js').then(({ getFeedbackHistory }) => {
    const slot = overlay.querySelector('#feedback-history-slot');
    if (!slot) return;
    const history = getFeedbackHistory();
    if (!history.length) {
      slot.innerHTML = `<div style="font-size:var(--font-xs);color:var(--color-text-disabled);">No feedback submitted yet.</div>`;
      return;
    }
    slot.innerHTML = history.slice(0, 5).map(h => `
      <div style="display:flex;align-items:center;gap:var(--space-2);padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:var(--font-xs);">
        <span style="color:var(--color-text-muted);flex-shrink:0;">${_feedbackIcon(h.category)}</span>
        <span style="flex:1;color:var(--color-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(h.description || 'Untitled')}</span>
        <span style="color:var(--color-text-disabled);flex-shrink:0;">${timeAgo(h.timestamp)}</span>
      </div>
    `).join('');
  }).catch(() => {});

  setTimeout(() => overlay.querySelector('#settings-close')?.focus(), 50);
}

/**
 * Render settings inline into a container (for tab-panel usage).
 * Same content as the modal, but without the overlay wrapper.
 */
export function renderSettingsInline(container) {
  _refreshCache();
  const cfg = getConfig();
  const q   = _cache.videoQuality || cfg.capture.defaultVideoQuality;
  const aq  = _cache.audioQuality || cfg.capture.defaultAudioQuality;
  const aiP = _cache.aiProvider || 'openai';
  const hasAiKey = aiP === 'gemini' ? !!_cache.geminiKey : !!_cache.openaiKey;

  container.innerHTML = `
    <div class="card card-compact animate-in" style="display:flex;flex-direction:column;gap:0;">
      <form autocomplete="off" onsubmit="return false" style="display:flex;flex-direction:column;gap:var(--space-5);padding:var(--space-4);">
        <div class="flex-between">
          <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);display:flex;align-items:center;gap:var(--space-2);">${icons.settings(14)} Settings</span>
          <span id="settings-saved-indicator" style="font-size:var(--font-xs);color:var(--color-success);opacity:0;transition:opacity 0.3s;">✓ Saved</span>
        </div>

        <!-- AI Provider -->
        <div style="border:1px solid rgba(124,58,237,0.25);border-radius:var(--radius-md);padding:var(--space-4);background:rgba(124,58,237,0.05);">
          <div style="font-size:var(--font-sm);font-weight:var(--weight-bold);margin-bottom:var(--space-3);display:flex;align-items:center;gap:var(--space-2);color:var(--color-primary-light);">
            ${icons.zap(14)} AI Provider
            <span id="ai-status-pill" style="margin-left:auto;font-size:var(--font-xs);font-weight:500;color:${hasAiKey ? 'var(--color-success)' : 'var(--color-warning)'};display:flex;align-items:center;gap:4px;">
              <span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;flex-shrink:0;"></span>
              ${hasAiKey ? 'Configured' : 'No API key'}
            </span>
          </div>
          <div class="input-group" style="margin-bottom:var(--space-3);">
            <label for="setting-ai-provider">Provider</label>
            <select class="select" id="setting-ai-provider">
              <option value="openai"  ${aiP==='openai' ?'selected':''}>OpenAI — Whisper + GPT-4o-mini</option>
              <option value="gemini"  ${aiP==='gemini' ?'selected':''}>Google Gemini 2.0 Flash</option>
            </select>
          </div>
          <div id="ai-openai-section" ${aiP!=='openai'?'style="display:none"':''}>
            <div class="input-group">
              <label for="setting-openai">OpenAI API Key</label>
              <div style="display:flex;gap:var(--space-2);">
                <input class="input" type="password" id="setting-openai" value="${esc(_cache.openaiKey||'')}" placeholder="sk-…" autocomplete="off" style="flex:1;" />
                <button class="btn btn-ghost btn-sm" id="test-openai-key" type="button" title="Verify this key works">${icons.zap(14)} Test</button>
              </div>
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:4px;">
                Used for Whisper transcription and GPT-4o-mini summary. Stored locally only.
              </div>
            </div>
          </div>
          <div id="ai-gemini-section" ${aiP!=='gemini'?'style="display:none"':''}>
            <div class="input-group">
              <label for="setting-gemini">Google Gemini API Key</label>
              <div style="display:flex;gap:var(--space-2);">
                <input class="input" type="password" id="setting-gemini" value="${esc(_cache.geminiKey||'')}" placeholder="AIza…" autocomplete="off" style="flex:1;" />
                <button class="btn btn-ghost btn-sm" id="test-gemini-key" type="button" title="Verify this key works">${icons.zap(14)} Test</button>
              </div>
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:4px;">
                Gemini 2.0 Flash handles transcription and summary in one call.
                Get a free key at <span style="color:var(--color-primary-light);">aistudio.google.com</span>.
              </div>
            </div>
          </div>
        </div>

        <!-- Capture Quality -->
        <div>
          <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);margin-bottom:var(--space-3);color:var(--color-text-secondary);">Capture Quality</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);">
            <div class="input-group">
              <label for="setting-video">Video</label>
              <select class="select" id="setting-video">
                <option value="480p"  ${q==='480p' ?'selected':''}>480p SD</option>
                <option value="720p"  ${q==='720p' ?'selected':''}>720p HD</option>
                <option value="1080p" ${q==='1080p'?'selected':''}>1080p FHD</option>
              </select>
            </div>
            <div class="input-group">
              <label for="setting-audio">Audio</label>
              <select class="select" id="setting-audio">
                <option value="low"    ${aq==='low'   ?'selected':''}>64 kbps</option>
                <option value="medium" ${aq==='medium'?'selected':''}>96 kbps</option>
                <option value="high"   ${aq==='high'  ?'selected':''}>128 kbps</option>
              </select>
            </div>
          </div>
          <div id="size-estimate" style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:var(--space-2);"></div>
        </div>

        <!-- Watermark + Auto-copy -->
        <div style="display:flex;flex-direction:column;gap:var(--space-3);">
          <div class="input-group">
            <label for="setting-watermark">Video Watermark (Optional)</label>
            <input class="input" type="text" id="setting-watermark" value="${esc(_cache.watermarkText||'')}" placeholder="e.g. Confidential" autocomplete="off" maxlength="120" />
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);">Burns text into the video during export.</div>
              <div id="watermark-count" style="font-size:10px;color:var(--color-text-disabled);">${(_cache.watermarkText||'').length}/120</div>
            </div>
          </div>
          <div class="input-group" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" id="setting-autocopy" ${_cache.autoCopyLink!==false?'checked':''} />
            <label for="setting-autocopy" style="margin:0;">Auto-copy link after upload</label>
          </div>
          <div class="input-group" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" id="setting-notifications" ${_cache.desktopNotifications?'checked':''} ${typeof Notification === 'undefined' ? 'disabled' : ''} />
            <label for="setting-notifications" style="margin:0;">${icons.bell(12)} Desktop notifications when AI finishes</label>
          </div>
        </div>

        <!-- Keyboard Shortcuts -->
        <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:var(--space-4);">
          <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);margin-bottom:var(--space-3);color:var(--color-text-secondary);">Keyboard Shortcuts</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-2);">
            <div class="input-group">
              <label for="shortcut-record" style="font-size:var(--font-xs);">Record</label>
              <input class="input" type="text" id="shortcut-record" value="${_cache.shortcutRecord||'r'}" maxlength="1" style="text-align:center;" autocomplete="off" />
            </div>
            <div class="input-group">
              <label for="shortcut-pause" style="font-size:var(--font-xs);">Pause</label>
              <input class="input" type="text" id="shortcut-pause" value="${(_cache.shortcutPause||' ')===' '?'Space':(_cache.shortcutPause||' ')}" maxlength="5" style="text-align:center;" autocomplete="off" />
            </div>
            <div class="input-group">
              <label for="shortcut-stop" style="font-size:var(--font-xs);">Stop</label>
              <input class="input" type="text" id="shortcut-stop" value="${_cache.shortcutStop||'s'}" maxlength="1" style="text-align:center;" autocomplete="off" />
            </div>
          </div>
        </div>

        <!-- Cloud Sync -->
        <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:var(--space-4);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);">Cloud Sync</div>
              <div id="cloud-sync-status" style="font-size:var(--font-xs);color:var(--color-text-muted);"></div>
            </div>
          </div>
          <div style="font-size:10px;color:var(--color-text-disabled);margin-top:var(--space-2);">
            ${icons.shield(10)} API keys are stored locally and never synced to the cloud.
          </div>
        </div>

        <!-- Feedback & Diagnostics -->
        <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:var(--space-4);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);display:flex;align-items:center;gap:var(--space-2);">${icons.flag(14)} Feedback & Diagnostics</div>
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);">Report bugs, suggest features, or view past submissions</div>
            </div>
            <button class="btn btn-ghost btn-sm" id="btn-open-feedback-inline">${icons.send(14)} New</button>
          </div>
          <div id="feedback-history-slot-inline" style="margin-top:var(--space-3);"></div>
        </div>

        <!-- Auto-Runs -->
        <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:var(--space-4);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3);">
            <div>
              <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);display:flex;align-items:center;gap:var(--space-2);color:var(--color-text-secondary);">${icons.zap(14)} Auto-Runs</div>
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);">Automation rules that trigger processing without manual action</div>
            </div>
          </div>
          <div id="auto-runs-slot" style="display:flex;flex-direction:column;gap:var(--space-2);"></div>
          <div id="auto-runs-presets-slot" style="margin-top:var(--space-3);"></div>
        </div>

        <!-- Labs -->
        <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:var(--space-4);">
          <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);margin-bottom:var(--space-1);display:flex;align-items:center;gap:var(--space-2);color:var(--color-warning);">
            ${icons.zap(14)} Labs
          </div>
          <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:var(--space-3);">Toggle experimental features. Changes take effect immediately.</div>
          <div id="labs-flags-slot" style="display:flex;flex-direction:column;gap:var(--space-2);"></div>
        </div>

        <!-- Per-App Settings -->
        <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:var(--space-4);">
          <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);margin-bottom:var(--space-1);display:flex;align-items:center;gap:var(--space-2);color:var(--color-text-secondary);">
            ${icons.grid(14)} App Settings
          </div>
          <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:var(--space-3);">Configure individual app preferences.</div>
          <div id="app-settings-slot" style="display:flex;flex-direction:column;gap:var(--space-3);"></div>
        </div>
      </form>
    </div>

    <!-- Data & Export -->
    <div style="border-top:1px solid rgba(255,255,255,0.08);padding:var(--space-4) var(--space-5);">
      <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);margin-bottom:var(--space-1);display:flex;align-items:center;gap:var(--space-2);color:var(--color-text-secondary);">
        ${icons.download(14)} Data & Export
      </div>
      <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:var(--space-3);">Export your entries, tasks, goals, and decisions.</div>

      <div style="display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-3);">
        <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-xs);color:var(--color-text-secondary);cursor:pointer;">
          <input type="checkbox" id="export-transcripts" checked style="accent-color:var(--color-primary);" /> Include transcripts
        </label>
        <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-xs);color:var(--color-text-secondary);cursor:pointer;">
          <input type="checkbox" id="export-tasks" checked style="accent-color:var(--color-primary);" /> Include tasks
        </label>
        <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-xs);color:var(--color-text-secondary);cursor:pointer;">
          <input type="checkbox" id="export-goals" checked style="accent-color:var(--color-primary);" /> Include goals
        </label>
      </div>

      <div style="display:flex;gap:var(--space-2);">
        <button id="export-json-btn" class="btn btn-outline" style="font-size:var(--font-xs);padding:4px 12px;gap:4px;">${icons.download(12)} Export JSON</button>
        <button id="export-md-btn" class="btn btn-ghost" style="font-size:var(--font-xs);padding:4px 12px;gap:4px;">${icons.edit(12)} Export Markdown</button>
      </div>
      <div id="export-status" style="font-size:10px;color:var(--color-text-disabled);margin-top:var(--space-2);"></div>
    </div>

    <div id="auto-record-settings-slot"></div>`;

  // ── Bind events (same as modal) ─────────────────────────────────────────
  _bindSettingsEvents(container, cfg);

  // ── Labs flags ─────────────────────────────────────────────────────────
  getAllFlags().then(flags => {
    const slot = container.querySelector('#labs-flags-slot');
    if (!slot) return;
    const tierColors = { stable: 'var(--color-success)', beta: 'var(--color-warning)', experimental: 'var(--color-danger)' };
    slot.innerHTML = flags.map(f => `
      <label style="display:flex;align-items:center;gap:var(--space-2);cursor:pointer;padding:6px var(--space-3);border-radius:var(--radius-sm);background:rgba(255,255,255,0.02);">
        <input type="checkbox" data-flag="${f.name}" ${f.enabled ? 'checked' : ''} style="flex-shrink:0;" />
        <div style="flex:1;min-width:0;">
          <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${esc(f.label)}</div>
          <div style="font-size:10px;color:var(--color-text-disabled);">${esc(f.desc)}</div>
        </div>
        <span style="font-size:9px;color:${tierColors[f.tier] || 'var(--color-text-disabled)'};text-transform:uppercase;font-weight:var(--weight-semi);flex-shrink:0;">${f.tier}</span>
      </label>
    `).join('');
    slot.querySelectorAll('input[data-flag]').forEach(input => {
      input.addEventListener('change', async (e) => {
        await setFlag(e.target.dataset.flag, e.target.checked);
        toast.success('Flag updated', `${e.target.dataset.flag} ${e.target.checked ? 'enabled' : 'disabled'}.`);
      });
    });
  }).catch(() => {});

  // ── Per-App Settings ──────────────────────────────────────────────────
  _renderAppSettings(container.querySelector('#app-settings-slot'));

  // Lazy-load auto-record settings panel
  import('./auto-record-panel.js')
    .then(m => m.renderAutoRecordSettings(container.querySelector('#auto-record-settings-slot')))
    .catch(() => {});

  // ── Export buttons ──────────────────────────────────────────
  const _getExportOpts = () => ({
    includeTranscripts: container.querySelector('#export-transcripts')?.checked !== false,
    includeTasks: container.querySelector('#export-tasks')?.checked !== false,
    includeGoals: container.querySelector('#export-goals')?.checked !== false,
  });
  const _exportStatus = (msg) => {
    const el = container.querySelector('#export-status');
    if (el) el.textContent = msg;
  };

  container.querySelector('#export-json-btn')?.addEventListener('click', async () => {
    _exportStatus('Exporting…');
    try {
      const { downloadExportJSON } = await import('../lib/export-engine.js');
      const summary = await downloadExportJSON(_getExportOpts());
      _exportStatus(`✓ Exported ${summary.entries} entries, ${summary.tasks} tasks, ${summary.goals} goals`);
      toast.success('Export complete', `${summary.entries} entries exported.`);
    } catch (e) {
      _exportStatus(`✗ Export failed: ${e.message}`);
      toast.error('Export failed', e.message);
    }
  });

  container.querySelector('#export-md-btn')?.addEventListener('click', async () => {
    _exportStatus('Exporting…');
    try {
      const { downloadExportMarkdown } = await import('../lib/export-engine.js');
      await downloadExportMarkdown(_getExportOpts());
      _exportStatus('✓ Markdown export downloaded');
      toast.success('Export complete', 'Markdown file downloaded.');
    } catch (e) {
      _exportStatus(`✗ Export failed: ${e.message}`);
      toast.error('Export failed', e.message);
    }
  });
}

/**
 * Shared event binding for settings controls. Works for both modal and inline.
 * @param {HTMLElement} root   The container holding the settings form
 * @param {object}      cfg    Runtime config from getConfig()
 */
function _bindSettingsEvents(root, cfg) {
  // ── AI status pill ──────────────────────────────────────────────────────
  function _refreshStatusPill() {
    const pill = root.querySelector('#ai-status-pill');
    if (!pill) return;
    const p = root.querySelector('#setting-ai-provider')?.value || _cache.aiProvider || 'openai';
    const hasKey = p === 'gemini' ? !!_cache.geminiKey : !!_cache.openaiKey;
    pill.style.color = hasKey ? 'var(--color-success)' : 'var(--color-warning)';
    pill.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;flex-shrink:0;"></span> ${hasKey ? 'Configured' : 'No API key'}`;
  }

  // ── Saved flash ──────────────────────────────────────────────────────────
  let _savedTimer = null;
  function flashSaved() {
    const el = root.querySelector('#settings-saved-indicator');
    if (!el) return;
    el.style.opacity = '1';
    clearTimeout(_savedTimer);
    _savedTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
  }
  function saveAndFlash(key, value) { _saveAndCache(key, value); flashSaved(); }

  // ── AI Provider switching ────────────────────────────────────────────────
  const aiSelect = root.querySelector('#setting-ai-provider');
  const openaiSec = root.querySelector('#ai-openai-section');
  const geminiSec = root.querySelector('#ai-gemini-section');

  aiSelect?.addEventListener('change', (e) => {
    const p = e.target.value;
    saveAndFlash('aiProvider', p);
    if (openaiSec) openaiSec.style.display = p === 'openai' ? '' : 'none';
    if (geminiSec) geminiSec.style.display = p === 'gemini' ? '' : 'none';
    _refreshStatusPill();
  });

  root.querySelector('#setting-openai')?.addEventListener('change', (e) => {
    const val = e.target.value.trim();
    if (val && !val.startsWith('sk-')) {
      toast.warning('Invalid API key', 'OpenAI keys start with "sk-".');
      e.target.style.borderColor = 'var(--color-danger)';
      return;
    }
    e.target.style.borderColor = '';
    saveAndFlash('openaiKey', val);
    _refreshStatusPill();
  });

  root.querySelector('#setting-gemini')?.addEventListener('change', (e) => {
    const val = e.target.value.trim();
    if (val && !val.startsWith('AIza')) {
      toast.warning('Invalid Gemini key', 'Gemini API keys start with "AIza".');
      e.target.style.borderColor = 'var(--color-danger)';
      return;
    }
    e.target.style.borderColor = '';
    saveAndFlash('geminiKey', val);
    _refreshStatusPill();
  });

  // ── API key test buttons ──────────────────────────────────────────────────
  async function _testKey(btn, testFn) {
    if (btn.disabled) return;
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div>`;
    try { await testFn(); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
  }

  root.querySelector('#test-openai-key')?.addEventListener('click', (e) => {
    _testKey(e.currentTarget, async () => {
      const key = root.querySelector('#setting-openai')?.value?.trim() || _cache.openaiKey;
      if (!key) { toast.warning('No key entered', 'Enter your OpenAI API key first.'); return; }
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${key}` },
          signal: controller.signal,
        });
        clearTimeout(tid);
        if (res.ok) { toast.success('Key valid', 'OpenAI API key is working correctly.'); }
        else if (res.status === 401) { toast.error('Invalid key', 'OpenAI rejected this API key.'); }
        else if (res.status === 429) { toast.warning('Rate limited', 'Key is valid but currently rate-limited.'); }
        else { toast.error('Test failed', `OpenAI returned ${res.status}.`); }
      } catch (e) {
        clearTimeout(tid);
        if (e.name === 'AbortError') toast.error('Timed out', 'Request took too long — check your connection.');
        else toast.error('Network error', 'Could not reach the OpenAI API.');
      }
    });
  });

  root.querySelector('#test-gemini-key')?.addEventListener('click', (e) => {
    _testKey(e.currentTarget, async () => {
      const key = root.querySelector('#setting-gemini')?.value?.trim() || _cache.geminiKey;
      if (!key) { toast.warning('No key entered', 'Enter your Gemini API key first.'); return; }
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1 } }),
            signal: controller.signal,
          }
        );
        clearTimeout(tid);
        if (res.ok) { toast.success('Key valid', 'Gemini API key is working correctly.'); return; }
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.message || '';
        if (res.status === 400 && msg.toLowerCase().includes('api key')) {
          toast.error('Invalid key', 'Gemini rejected this API key.');
        } else if (res.status === 400) {
          toast.success('Key valid', 'Gemini API key appears to work.');
        } else if (res.status === 429) {
          toast.warning('Rate limited', 'Key is valid but currently rate-limited.');
        } else {
          toast.error('Test failed', `Gemini returned ${res.status}.`);
        }
      } catch (e) {
        clearTimeout(tid);
        if (e.name === 'AbortError') toast.error('Timed out', 'Request took too long — check your connection.');
        else toast.error('Network error', 'Could not reach the Gemini API.');
      }
    });
  });

  // ── Quality ──────────────────────────────────────────────────────────────
  function updateEstimate() {
    const vq = root.querySelector('#setting-video')?.value || '720p';
    const aqv = root.querySelector('#setting-audio')?.value || 'medium';
    const vBitrate = cfg.capture.qualities[vq]?.bitrate || 2_500_000;
    const aBitrate = cfg.capture.audioQualities[aqv] || 96_000;
    const mbPerMin = ((vBitrate + aBitrate) * 60) / 8 / (1024 * 1024);
    const el = root.querySelector('#size-estimate');
    if (el) el.textContent = `≈ ${mbPerMin.toFixed(1)} MB/min · ${(mbPerMin * 60).toFixed(0)} MB/hour`;
  }
  updateEstimate();
  root.querySelector('#setting-video')?.addEventListener('change', (e) => { saveAndFlash('videoQuality', e.target.value); updateEstimate(); });
  root.querySelector('#setting-audio')?.addEventListener('change', (e) => { saveAndFlash('audioQuality', e.target.value); updateEstimate(); });

  const watermarkInput = root.querySelector('#setting-watermark');
  const watermarkCount = root.querySelector('#watermark-count');
  watermarkInput?.addEventListener('input', (e) => {
    if (watermarkCount) watermarkCount.textContent = `${e.target.value.length}/120`;
  });
  watermarkInput?.addEventListener('change', (e) => saveAndFlash('watermarkText', e.target.value.trim()));
  root.querySelector('#setting-autocopy')?.addEventListener('change', (e) => saveAndFlash('autoCopyLink', e.target.checked));

  root.querySelector('#setting-notifications')?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      if (Notification.permission === 'denied') {
        toast.warning('Notifications blocked', 'Allow notifications in your browser site settings.');
        e.target.checked = false;
        return;
      }
      const perm = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission().catch(() => 'denied');
      if (perm !== 'granted') {
        toast.warning('Permission not granted', 'Notifications could not be enabled.');
        e.target.checked = false;
        return;
      }
    }
    saveAndFlash('desktopNotifications', e.target.checked);
  });

  // ── Shortcuts ─────────────────────────────────────────────────────────────
  const processShortcut = (val, fallback) => {
    const raw = String(val || '').trim();
    if (!raw) return fallback;
    return raw.toLowerCase() === 'space' ? ' ' : raw.toLowerCase().slice(0, 1);
  };
  const otherShortcutValues = (excludeId) => {
    return ['#shortcut-record','#shortcut-pause','#shortcut-stop']
      .filter(s => s !== excludeId)
      .map(s => processShortcut(root.querySelector(s)?.value, ''))
      .filter(Boolean);
  };
  const bindShortcut = (selector, key, fallback) => {
    const input = root.querySelector(selector);
    input?.addEventListener('change', (e) => {
      const v = processShortcut(e.target.value, fallback);
      if (otherShortcutValues(selector).includes(v)) {
        toast.warning('Shortcut already in use', 'Pick a different key.');
        e.target.value = fallback === ' ' ? 'Space' : fallback;
        saveAndFlash(key, fallback);
        return;
      }
      saveAndFlash(key, v);
      e.target.value = v === ' ' ? 'Space' : v;
    });
  };
  bindShortcut('#shortcut-record', 'shortcutRecord', 'r');
  bindShortcut('#shortcut-pause',  'shortcutPause',  ' ');
  bindShortcut('#shortcut-stop',   'shortcutStop',   's');

  // ── Cloud Sync status ──────────────────────────────────────────────────
  const syncStatusEl = root.querySelector('#cloud-sync-status');
  if (syncStatusEl) {
    const cpm = CloudProviderManager.getInstance();
    const provider = cpm.getProvider();
    if (provider?.auth?.isConnected) {
      syncStatusEl.innerHTML = `<span style="color:var(--color-success);">${icons.check(10)} Auto-synced to ${esc(provider.name)}</span>`;
    } else {
      syncStatusEl.textContent = 'Connect a cloud provider to sync settings across devices';
    }
  }

  // ── Auto-Runs ────────────────────────────────────────────────────────
  _renderAutoRuns(root);

  // ── Feedback ──────────────────────────────────────────────────────────────
  root.querySelector('#btn-open-feedback-inline')?.addEventListener('click', () => {
    import('./feedback-modal.js').then(m => m.openFeedbackModal()).catch(() => {});
  });
  import('../lib/feedback-engine.js').then(({ getFeedbackHistory }) => {
    const slot = root.querySelector('#feedback-history-slot-inline');
    if (!slot) return;
    const history = getFeedbackHistory();
    if (!history.length) {
      slot.innerHTML = `<div style="font-size:var(--font-xs);color:var(--color-text-disabled);">No feedback submitted yet.</div>`;
      return;
    }
    slot.innerHTML = history.slice(0, 5).map(h => `
      <div style="display:flex;align-items:center;gap:var(--space-2);padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:var(--font-xs);">
        <span style="color:var(--color-text-muted);flex-shrink:0;">${_feedbackIcon(h.category)}</span>
        <span style="flex:1;color:var(--color-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(h.description || 'Untitled')}</span>
        <span style="color:var(--color-text-disabled);flex-shrink:0;">${timeAgo(h.timestamp)}</span>
      </div>
    `).join('');
  }).catch(() => {});
}
