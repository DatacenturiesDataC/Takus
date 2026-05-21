
// First-run guided setup for new users. Multi-step wizard with:
// 1. Welcome screen    2. Cloud provider connection
// 3. AI provider setup (REAL key input + validation)
// 4. Capture preferences
// 5. Ready screen

import { icons } from '../lib/icons.js';
import { getSetting, saveSetting } from '../lib/storage.js';
import { savePassport } from '../apps/passport/index.js';
import { saveAndCache } from '../lib/settings-store.js';

const SETUP_KEY = 'setupComplete';
const TOTAL_STEPS = 5;

/**
 * Check whether the setup wizard has been completed.
 * @returns {Promise<boolean>}
 */
export async function isSetupComplete() {
  const v = await getSetting(SETUP_KEY).catch(() => null);
  return v === true;
}

/**
 * Show the full-screen setup wizard overlay.
 * Resolves when the wizard is dismissed (completed or skipped).
 * @returns {Promise<void>}
 */
export function showSetupWizard() {
  return new Promise((resolve) => {
    let step = 1;
    let userName = '';
    let selectedProvider = 'gemini'; // Default to Gemini (free tier)
    let apiKey = '';
    let keyValidated = false;
    let keyValidating = false;
    let keyError = '';

    const overlay = document.createElement('div');
    overlay.id = 'setup-wizard';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Setup wizard');
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:var(--z-modal);',
      'display:flex;align-items:center;justify-content:center;padding:var(--space-4);',
      'background:var(--color-bg-deep);',
    ].join('');

    function render() {
      const progress = Math.round((step / TOTAL_STEPS) * 100);
      overlay.innerHTML = `
        <div style="width:100%;max-width:540px;display:flex;flex-direction:column;gap:var(--space-6);">
          <!-- Progress bar -->
          <div class="flex-center gap-3">
            <div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
              <div style="height:100%;width:${progress}%;background:var(--color-accent-gradient);border-radius:2px;transition:width 0.4s var(--ease-out);"></div>
            </div>
            <span style="font-size:var(--font-xs);color:var(--color-text-disabled);font-variant-numeric:tabular-nums;">${step}/${TOTAL_STEPS}</span>
            <button id="wizard-skip" class="btn btn-ghost btn-sm" style="font-size:var(--font-xs);color:var(--color-text-disabled);">Skip setup</button>
          </div>

          <!-- Step content -->
          <div class="card" style="padding:var(--space-8) var(--space-6);text-align:center;">
            ${_stepContent(step, { selectedProvider, apiKey, keyValidated, keyValidating, keyError })}
          </div>

          <!-- Navigation -->
          <div style="display:flex;justify-content:${step > 1 ? 'space-between' : 'flex-end'};gap:var(--space-3);">
            ${step > 1 ? `<button id="wizard-back" class="btn btn-ghost">${icons.chevronLeft?.(14) || '←'} Back</button>` : ''}
            <button id="wizard-next" class="btn btn-primary min-w-140" ${keyValidating ? 'disabled' : ''}>
              ${step === TOTAL_STEPS ? 'Get Started' : `Next ${icons.chevronRight?.(14) || '→'}`}
            </button>
          </div>
        </div>`;

      // Bind events
      overlay.querySelector('#wizard-skip')?.addEventListener('click', finish);
      overlay.querySelector('#wizard-back')?.addEventListener('click', () => { step--; render(); });
      overlay.querySelector('#wizard-next')?.addEventListener('click', () => {
        if (step < TOTAL_STEPS) { step++; render(); }
        else finish();
      });

      // Bind name input events for step 1
      const nameInput = overlay.querySelector('#wizard-name');
      if (nameInput) {
        nameInput.value = userName;
        nameInput.addEventListener('input', (e) => userName = e.target.value);
        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            overlay.querySelector('#wizard-next')?.click();
          }
        });
      }

      // Cloud connect button — close wizard first, then navigate to settings
      overlay.querySelector('#wizard-connect-settings')?.addEventListener('click', async () => {
        await finish();
        setTimeout(() => {
          const tab = document.querySelector('.main-tab[data-tab="settings"]');
          if (tab) tab.click();
        }, 100);
      });

      // ── Step 3: AI Provider — real configuration ────────────────────────

      // Provider toggle buttons
      overlay.querySelectorAll('.wiz-provider-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedProvider = btn.dataset.provider;
          apiKey = ''; // Reset key when switching providers
          keyValidated = false;
          keyError = '';
          render();
        });
      });

      // API key input
      const keyInput = overlay.querySelector('#wizard-api-key');
      if (keyInput) {
        keyInput.value = apiKey;
        keyInput.addEventListener('input', (e) => {
          apiKey = e.target.value.trim();
          keyValidated = false;
          keyError = '';
        });
        keyInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            overlay.querySelector('#wizard-test-key')?.click();
          }
        });
        // Focus the key input for immediate typing
        setTimeout(() => keyInput.focus(), 50);
      }

      // Test key button
      overlay.querySelector('#wizard-test-key')?.addEventListener('click', async () => {
        if (!apiKey || keyValidating) return;
        keyValidating = true;
        keyError = '';
        render();

        try {
          const isValid = await _testApiKey(apiKey, selectedProvider);
          keyValidating = false;
          if (isValid) {
            keyValidated = true;
            keyError = '';
            // Persist immediately
            saveAndCache('aiProvider', selectedProvider);
            if (selectedProvider === 'gemini') {
              saveAndCache('geminiKey', apiKey);
            } else {
              saveAndCache('openaiKey', apiKey);
            }
          } else {
            keyError = 'Invalid API key. Please check and try again.';
          }
        } catch (e) {
          keyValidating = false;
          keyError = e.message || 'Could not validate key. Check your connection.';
        }
        render();
      });

      // "Skip AI for now" link
      overlay.querySelector('#wizard-skip-ai')?.addEventListener('click', () => {
        apiKey = '';
        keyValidated = false;
        keyError = '';
        step++;
        render();
      });

      // Focus the next button (unless we're on a step with an input)
      if (!nameInput && !keyInput) {
        setTimeout(() => overlay.querySelector('#wizard-next')?.focus(), 50);
      }
    }

    async function finish() {
      if (userName.trim()) {
        try { await savePassport({ ownerName: userName.trim() }); } catch { /* non-critical */ }
      }
      // Save AI config if key was validated
      if (keyValidated && apiKey) {
        saveAndCache('aiProvider', selectedProvider);
        if (selectedProvider === 'gemini') {
          saveAndCache('geminiKey', apiKey);
        } else {
          saveAndCache('openaiKey', apiKey);
        }
      }
      await saveSetting(SETUP_KEY, true).catch(() => {});
      overlay.remove();
      resolve();
    }

    document.body.appendChild(overlay);
    render();
  });
}

function _stepContent(step, state = {}) {
  switch (step) {
    case 1: return `
      <div class="wiz-step-header">
        <div class="text-5xl mb-2">🎯</div>
        <h2 class="wiz-step-title text-2xl" >Welcome to Takus</h2>
        <p class="wiz-step-desc max-w-400" >
          Your adaptive Knowledge OS. Capture meetings, screens, and documents — then let AI connect your goals, tasks, people, and insights in one place.
        </p>
      </div>
      <div style="max-width:280px;margin:var(--space-4) auto 0;text-align:left;">
        <label for="wizard-name" style="font-size:var(--font-xs);color:var(--color-text-secondary);display:block;margin-bottom:var(--space-1);">What should we call you?</label>
        <input class="input" type="text" id="wizard-name" placeholder="Your name" autocomplete="name" style="width:100%;" />
      </div>
      <div class="wiz-features">
        ${_featureBadge(icons.video(16), 'Capture', 'Entries, docs & more')}
        ${_featureBadge(icons.zap(16), 'AI Intelligence', 'Goals, tasks & insights')}
        ${_featureBadge(icons.users(16), 'People', 'Track contacts & engagement')}
      </div>`;

    case 2: return `
      <div class="wiz-step-header">
        ${icons.cloud(32)}
        <h2 class="wiz-step-title">Connect Cloud Storage</h2>
        <p class="wiz-step-desc">
          Back up entries to Google Drive or OneDrive. You can skip this and set it up later in Settings.
        </p>
      </div>
      <div class="wiz-features">
        <button class="btn btn-ghost" id="wizard-connect-settings" style="padding:var(--space-3) var(--space-5);border:1px solid var(--color-border-strong);border-radius:var(--radius-md);display:flex;align-items:center;gap:var(--space-2);">
          ${icons.link(16)} Connect in Settings
        </button>
      </div>
      <p class="wiz-security-note">
        ${icons.shield(10)} Your data stays in your cloud. Takus never stores entries on our servers.
      </p>`;

    case 3: return _renderAIStep(state);

    case 4: return `
      <div class="wiz-step-header">
        ${icons.settings(32)}
        <h2 class="wiz-step-title">Capture Preferences</h2>
        <p class="wiz-step-desc">
          These defaults can be changed anytime from the Settings tab.
        </p>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-3);max-width:320px;margin:var(--space-4) auto 0;text-align:left;">
        <div class="wiz-pref-row">
          <span class="wiz-pref-label">Video Quality</span>
          <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);color:var(--color-text-primary);">1080p (default)</span>
        </div>
        <div class="wiz-pref-row">
          <span class="wiz-pref-label">Record Shortcut</span>
          <kbd class="wiz-kbd">R</kbd>
        </div>
        <div class="wiz-pref-row">
          <span class="wiz-pref-label">Pause Shortcut</span>
          <kbd class="wiz-kbd">Space</kbd>
        </div>
        <div class="wiz-pref-row">
          <span class="wiz-pref-label">Stop Shortcut</span>
          <kbd class="wiz-kbd">S</kbd>
        </div>
        ${state.keyValidated ? `
        <div class="wiz-pref-row" style="border-top:1px solid var(--color-border);padding-top:var(--space-3);margin-top:var(--space-1);">
          <span class="wiz-pref-label">AI Provider</span>
          <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);color:var(--color-success);">✓ ${state.selectedProvider === 'gemini' ? 'Gemini' : 'OpenAI'} configured</span>
        </div>` : `
        <div class="wiz-pref-row" style="border-top:1px solid var(--color-border);padding-top:var(--space-3);margin-top:var(--space-1);">
          <span class="wiz-pref-label">AI Provider</span>
          <span style="font-size:var(--font-sm);color:var(--color-warning);">⚠ Not configured yet</span>
        </div>`}
      </div>`;

    case 5: return `
      <div class="wiz-step-header">
        <div class="text-5xl mb-2">🚀</div>
        <h2 class="wiz-step-title text-2xl" >You're All Set!</h2>
        <p class="wiz-step-desc max-w-400" >
          Here's how to get started with your first capture:
        </p>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-3);max-width:360px;margin:var(--space-4) auto 0;">
        ${_actionStep('1', '🎤', 'Capture a meeting', 'Click the record button or press <kbd style="background:var(--color-bg-elevated);padding:1px 6px;border-radius:4px;font-size:var(--font-xs);font-weight:var(--weight-semi);">R</kbd>')}
        ${_actionStep('2', '🤖', 'Let AI process', state.keyValidated
          ? 'Takus will automatically transcribe, summarize, and extract tasks'
          : 'Add your API key in Settings → AI Provider to enable AI processing'
        )}
        ${_actionStep('3', '🔍', 'Search & connect', 'Ask questions across all your knowledge in the Ask tab')}
      </div>`;

    default: return '';
  }
}

/**
 * Step 3: AI Provider — real configuration with key input and validation
 */
function _renderAIStep(state) {
  const { selectedProvider, apiKey, keyValidated, keyValidating, keyError } = state;
  const isGemini = selectedProvider === 'gemini';

  const getKeyLink = isGemini
    ? 'https://aistudio.google.com/apikey'
    : 'https://platform.openai.com/api-keys';
  const getKeyLabel = isGemini ? 'Google AI Studio' : 'OpenAI Dashboard';

  return `
    <div class="wiz-step-header">
      ${icons.zap(32)}
      <h2 class="wiz-step-title">AI Provider</h2>
      <p class="wiz-step-desc">
        Takus uses AI to transcribe, summarize, and extract tasks from your recordings.
        Add your API key to enable these features.
      </p>
    </div>

    <!-- Provider toggle -->
    <div style="display:flex;justify-content:center;gap:var(--space-2);margin-bottom:var(--space-4);">
      <button class="wiz-provider-btn btn ${isGemini ? 'btn-primary' : 'btn-ghost'}" data-provider="gemini"
        style="padding:var(--space-2) var(--space-4);border-radius:var(--radius-md);font-size:var(--font-sm);${!isGemini ? 'border:1px solid var(--color-border);' : ''}">
        Gemini <span style="font-size:10px;opacity:0.7;margin-left:4px;">Free tier</span>
      </button>
      <button class="wiz-provider-btn btn ${!isGemini ? 'btn-primary' : 'btn-ghost'}" data-provider="openai"
        style="padding:var(--space-2) var(--space-4);border-radius:var(--radius-md);font-size:var(--font-sm);${isGemini ? 'border:1px solid var(--color-border);' : ''}">
        OpenAI <span style="font-size:10px;opacity:0.7;margin-left:4px;">Best accuracy</span>
      </button>
    </div>

    <!-- API key input -->
    <div style="max-width:380px;margin:0 auto;text-align:left;">
      <label for="wizard-api-key" style="font-size:var(--font-xs);color:var(--color-text-secondary);display:block;margin-bottom:var(--space-1);">
        ${isGemini ? 'Gemini' : 'OpenAI'} API Key
      </label>
      <div style="display:flex;gap:var(--space-2);">
        <input class="input" type="password" id="wizard-api-key"
          placeholder="${isGemini ? 'AIza...' : 'sk-...'}"
          autocomplete="off" spellcheck="false"
          style="flex:1;font-family:monospace;font-size:var(--font-xs);"
          value="${apiKey || ''}" />
        <button id="wizard-test-key" class="btn ${keyValidated ? 'btn-success' : 'btn-primary'} btn-sm"
          style="white-space:nowrap;min-width:80px;" ${keyValidating ? 'disabled' : ''}>
          ${keyValidating ? '<span class="spinner-dots">Validating…</span>'
            : keyValidated ? '✓ Valid' : 'Test Key'}
        </button>
      </div>

      ${keyError ? `
        <div style="margin-top:var(--space-2);font-size:var(--font-xs);color:var(--color-error);display:flex;align-items:center;gap:var(--space-1);">
          ⚠ ${_esc(keyError)}
        </div>` : ''}

      ${keyValidated ? `
        <div style="margin-top:var(--space-2);font-size:var(--font-xs);color:var(--color-success);display:flex;align-items:center;gap:var(--space-1);">
          ✓ Key saved! AI processing is now enabled.
        </div>` : ''}

      <div style="margin-top:var(--space-3);font-size:var(--font-xs);color:var(--color-text-disabled);">
        Get a free key from <a href="${getKeyLink}" target="_blank" rel="noopener"
          style="color:var(--color-primary-light);text-decoration:underline;">${getKeyLabel}</a>
      </div>
    </div>

    <div style="margin-top:var(--space-4);">
      <button id="wizard-skip-ai" class="btn btn-ghost btn-sm"
        style="font-size:var(--font-xs);color:var(--color-text-disabled);">
        Skip — I'll add a key later in Settings
      </button>
    </div>

    <p class="wiz-security-note">
      ${icons.shield(10)} API keys are stored locally in your browser and never leave your device.
    </p>`;
}

/**
 * Test an API key by making a minimal request.
 * For Gemini: list models. For OpenAI: list models.
 */
async function _testApiKey(key, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    if (provider === 'gemini') {
      // Gemini: lightweight model list request
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
        {
          headers: { 'x-goog-api-key': key },
          signal: controller.signal,
        },
      );
      return res.ok;
    } else {
      // OpenAI: lightweight model list request
      const res = await fetch(
        'https://api.openai.com/v1/models?limit=1',
        {
          headers: { 'Authorization': `Bearer ${key}` },
          signal: controller.signal,
        },
      );
      return res.ok;
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out. Check your connection.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal HTML escaping */
function _esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _featureBadge(icon, title, desc) {
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-1);padding:var(--space-3);background:var(--color-bg-surface);border-radius:var(--radius-md);width:120px;">
    <span class="text-primary">${icon}</span>
    <span class="text-xs fw-semi" >${title}</span>
    <span class="text-10-disabled">${desc}</span>
  </div>`;
}

function _actionStep(num, emoji, title, desc) {
  return `<div style="display:flex;align-items:flex-start;gap:var(--space-3);padding:var(--space-3);background:var(--color-bg-surface);border-radius:var(--radius-md);border:1px solid var(--color-border);text-align:left;">
    <div style="width:28px;height:28px;border-radius:50%;background:var(--color-primary-dim);color:var(--color-primary-light);display:flex;align-items:center;justify-content:center;font-weight:var(--weight-bold);font-size:var(--font-xs);flex-shrink:0;">${num}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-weight:var(--weight-semi);font-size:var(--font-sm);color:var(--color-text-primary);">${emoji} ${title}</div>
      <div style="font-size:var(--font-xs);color:var(--color-text-secondary);margin-top:2px;">${desc}</div>
    </div>
  </div>`;
}
