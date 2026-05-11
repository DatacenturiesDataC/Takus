// Takus — Settings Panel (modal overlay)
import { icons } from '../lib/icons.js';
import { getConfig } from '../lib/config.js';
import { saveSetting, getSetting } from '../lib/storage.js';
import { CloudProviderManager } from '../lib/cloud-provider.js';
import { toast } from './toast.js';
import { openConnectModal } from './connect-panel.js';

function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

// ── In-memory settings cache ──────────────────────────────────────────────────
// Populated by initSettings() on app start; updated by every saveSetting call.
const _cache = {
  videoQuality: '720p', audioQuality: 'medium',
  watermarkText: '', autoCopyLink: true,
  aiProvider: 'openai', openaiKey: '', geminiKey: '',
  shortcutRecord: 'r', shortcutPause: ' ', shortcutStop: 's',
};

export async function initSettings() {
  const keys = ['videoQuality','audioQuality','watermarkText','autoCopyLink',
                 'aiProvider','openaiKey','geminiKey',
                 'shortcutRecord','shortcutPause','shortcutStop'];
  const vals = await Promise.all(keys.map(k => getSetting(k)));
  keys.forEach((k, i) => { if (vals[i] != null) _cache[k] = vals[i]; });
}

function _saveAndCache(key, value) {
  _cache[key] = value;
  saveSetting(key, value);
}

export function getSettings() {
  return {
    videoQuality: _cache.videoQuality || '720p',
    audioQuality: _cache.audioQuality || 'medium',
    watermarkText: _cache.watermarkText || '',
    autoCopyLink: _cache.autoCopyLink !== false,
    aiProvider: _cache.aiProvider || 'openai',
    openaiKey: _cache.openaiKey || '',
    geminiKey: _cache.geminiKey || '',
  };
}

export async function getShortcuts() {
  return {
    record: _cache.shortcutRecord || 'r',
    pause:  _cache.shortcutPause  || ' ',
    stop:   _cache.shortcutStop   || 's',
  };
}

// ── Modal entry point ─────────────────────────────────────────────────────────
export function openSettingsModal() {
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
  const q   = _cache.videoQuality || cfg.recording.defaultVideoQuality;
  const aq  = _cache.audioQuality || cfg.recording.defaultAudioQuality;
  const aiP = _cache.aiProvider || 'openai';
  const hasAiKey = aiP === 'gemini' ? !!_cache.geminiKey : !!_cache.openaiKey;

  overlay.innerHTML = `
    <div class="card animate-in" style="width:100%;max-width:540px;margin-top:var(--space-8);display:flex;flex-direction:column;gap:0;">
      <div class="card-header" style="position:sticky;top:0;background:var(--color-bg-surface);backdrop-filter:blur(8px);z-index:1;flex-shrink:0;">
        <h3 style="display:flex;align-items:center;gap:var(--space-2);">${icons.settings(16)} Settings</h3>
        <div style="display:flex;align-items:center;gap:var(--space-3);">
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

        <!-- Recording Quality -->
        <div>
          <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);margin-bottom:var(--space-3);color:var(--color-text-secondary);">Recording Quality</div>
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
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);">Backup settings to your connected cloud</div>
            </div>
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn-ghost btn-sm" id="btn-fetch-settings">Restore</button>
              <button class="btn btn-primary btn-sm" id="btn-sync-settings">Backup</button>
            </div>
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

  // ── AI status pill ─────────────────────────────────────────────────────────
  function _refreshStatusPill() {
    const pill = overlay.querySelector('#ai-status-pill');
    if (!pill) return;
    const p = overlay.querySelector('#setting-ai-provider')?.value || _cache.aiProvider || 'openai';
    const hasKey = p === 'gemini' ? !!_cache.geminiKey : !!_cache.openaiKey;
    pill.style.color = hasKey ? 'var(--color-success)' : 'var(--color-warning)';
    pill.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;flex-shrink:0;"></span> ${hasKey ? 'Configured' : 'No API key'}`;
  }

  // ── Saved flash ────────────────────────────────────────────────────────────
  let _savedTimer = null;
  function flashSaved() {
    const el = overlay.querySelector('#settings-saved-indicator');
    if (!el) return;
    el.style.opacity = '1';
    clearTimeout(_savedTimer);
    _savedTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
  }
  function saveAndFlash(key, value) { _saveAndCache(key, value); flashSaved(); }

  // ── AI Provider switching ──────────────────────────────────────────────────
  const aiSelect = overlay.querySelector('#setting-ai-provider');
  const openaiSec = overlay.querySelector('#ai-openai-section');
  const geminiSec = overlay.querySelector('#ai-gemini-section');

  aiSelect.addEventListener('change', (e) => {
    const p = e.target.value;
    saveAndFlash('aiProvider', p);
    openaiSec.style.display = p === 'openai' ? '' : 'none';
    geminiSec.style.display = p === 'gemini' ? '' : 'none';
    _refreshStatusPill();
  });

  overlay.querySelector('#setting-openai')?.addEventListener('change', (e) => {
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

  overlay.querySelector('#setting-gemini')?.addEventListener('change', (e) => {
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

  // ── API key test buttons ───────────────────────────────────────────────────
  async function _testKey(btn, testFn) {
    if (btn.disabled) return;
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div>`;
    try { await testFn(); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
  }

  overlay.querySelector('#test-openai-key')?.addEventListener('click', (e) => {
    _testKey(e.currentTarget, async () => {
      const key = overlay.querySelector('#setting-openai')?.value?.trim() || _cache.openaiKey;
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

  overlay.querySelector('#test-gemini-key')?.addEventListener('click', (e) => {
    _testKey(e.currentTarget, async () => {
      const key = overlay.querySelector('#setting-gemini')?.value?.trim() || _cache.geminiKey;
      if (!key) { toast.warning('No key entered', 'Enter your Gemini API key first.'); return; }
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

  // ── Quality ────────────────────────────────────────────────────────────────
  function updateEstimate() {
    const vq = overlay.querySelector('#setting-video')?.value || '720p';
    const aqv = overlay.querySelector('#setting-audio')?.value || 'medium';
    const vBitrate = cfg.recording.qualities[vq]?.bitrate || 2_500_000;
    const aBitrate = cfg.recording.audioQualities[aqv] || 96_000;
    const mbPerMin = ((vBitrate + aBitrate) * 60) / 8 / (1024 * 1024);
    const el = overlay.querySelector('#size-estimate');
    if (el) el.textContent = `≈ ${mbPerMin.toFixed(1)} MB/min · ${(mbPerMin * 60).toFixed(0)} MB/hour`;
  }
  updateEstimate();
  overlay.querySelector('#setting-video').addEventListener('change', (e) => { saveAndFlash('videoQuality', e.target.value); updateEstimate(); });
  overlay.querySelector('#setting-audio').addEventListener('change', (e) => { saveAndFlash('audioQuality', e.target.value); updateEstimate(); });

  const watermarkInput = overlay.querySelector('#setting-watermark');
  const watermarkCount = overlay.querySelector('#watermark-count');
  watermarkInput?.addEventListener('input', (e) => {
    if (watermarkCount) watermarkCount.textContent = `${e.target.value.length}/120`;
  });
  watermarkInput?.addEventListener('change', (e) => saveAndFlash('watermarkText', e.target.value.trim()));
  overlay.querySelector('#setting-autocopy')?.addEventListener('change', (e) => saveAndFlash('autoCopyLink', e.target.checked));

  // ── Shortcuts ──────────────────────────────────────────────────────────────
  const processShortcut = (val, fallback) => {
    const raw = String(val || '').trim();
    if (!raw) return fallback;
    return raw.toLowerCase() === 'space' ? ' ' : raw.toLowerCase().slice(0, 1);
  };
  const otherShortcutValues = (excludeId) => {
    return ['#shortcut-record','#shortcut-pause','#shortcut-stop']
      .filter(s => s !== excludeId)
      .map(s => processShortcut(overlay.querySelector(s)?.value, ''))
      .filter(Boolean);
  };
  const bindShortcut = (selector, key, fallback) => {
    const input = overlay.querySelector(selector);
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

  // ── Cloud Sync ─────────────────────────────────────────────────────────────
  overlay.querySelector('#btn-sync-settings')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; if (btn.disabled) return;
    btn.disabled = true; const orig = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div> Syncing…`;
    try {
      const cpm = CloudProviderManager.getInstance();
      const provider = cpm.getProvider();
      if (!provider) throw new Error('Connect a cloud provider first.');
      await provider.storage.syncSettings({
        videoQuality: _cache.videoQuality, audioQuality: _cache.audioQuality,
        watermarkText: _cache.watermarkText, autoCopyLink: _cache.autoCopyLink,
        aiProvider: _cache.aiProvider,
        shortcutRecord: _cache.shortcutRecord, shortcutPause: _cache.shortcutPause, shortcutStop: _cache.shortcutStop,
      });
      toast.success('Settings backed up', `Saved to ${provider.name}.`);
    } catch (e) { toast.error('Backup failed', e.message); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
  });

  overlay.querySelector('#btn-fetch-settings')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; if (btn.disabled) return;
    btn.disabled = true; const orig = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div> Restoring…`;
    try {
      const cpm = CloudProviderManager.getInstance();
      const provider = cpm.getProvider();
      if (!provider) throw new Error('Connect a cloud provider first.');
      const remote = await provider.storage.fetchSettings();
      if (remote) {
        for (const [k, v] of Object.entries(remote)) {
          if (v != null) { _cache[k] = v; await saveSetting(k, v); }
        }
        toast.success('Settings restored', 'Reopening settings…');
        closeModal();
        setTimeout(openSettingsModal, 150);
      } else {
        toast.info('No backup found', 'No settings found in cloud storage.');
      }
    } catch (e) { toast.error('Restore failed', e.message); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
  });

  overlay.querySelector('#btn-open-connect')?.addEventListener('click', () => {
    closeModal();
    setTimeout(openConnectModal, 100);
  });

  setTimeout(() => overlay.querySelector('#settings-close')?.focus(), 50);
}
