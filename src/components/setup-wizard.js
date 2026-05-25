
// First-run guided setup for new users. Multi-step wizard with:
// 1. Welcome screen    2. Workspace (create / join / skip)
// 3. AI provider setup (for workspace creators or solo users)
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

    // Workspace state
    let wsMode = 'solo'; // 'solo' | 'create' | 'join' — solo pre-selected as easy default
    let wsName = '';
    let wsInviteCode = '';
    let wsJoinResult = null;
    let wsCreateResult = null;
    let wsLoading = false;
    let wsError = '';
    let wsSuccess = '';

    // AI state (for creators and solo users)
    let selectedProvider = 'gemini';
    let apiKey = '';
    let keyValidated = false;
    let keyValidating = false;
    let keyError = '';

    // Restore partial wizard state from sessionStorage (survives page refresh)
    try {
      const saved = JSON.parse(sessionStorage.getItem('takus_wizard_state') || 'null');
      if (saved) {
        step = saved.step || 1;
        userName = saved.userName || '';
        wsMode = saved.wsMode || 'solo';
        wsName = saved.wsName || '';
        wsInviteCode = saved.inviteCode || '';
        selectedProvider = saved.provider || 'gemini';
      }
    } catch { /* ignore */ }

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
      // Persist non-sensitive wizard state so progress survives refresh
      try {
        sessionStorage.setItem('takus_wizard_state', JSON.stringify({
          step, userName, wsMode, wsName, inviteCode: wsInviteCode, provider: selectedProvider
        }));
      } catch { /* non-critical */ }

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
          <div class="card setup-wizard-card" style="padding:var(--space-8) var(--space-6);text-align:center;">
            ${_stepContent(step)}
          </div>

          <!-- Navigation -->
          <div style="display:flex;justify-content:${step > 1 ? 'space-between' : 'flex-end'};gap:var(--space-3);">
            ${step > 1 ? `<button id="wizard-back" class="btn btn-ghost">${icons.chevronLeft?.(14) || '←'} Back</button>` : ''}
            <button id="wizard-next" class="btn btn-primary min-w-140" ${keyValidating || wsLoading ? 'disabled' : ''}>
              ${step === TOTAL_STEPS ? 'Get Started' : `Next ${icons.chevronRight?.(14) || '→'}`}
            </button>
          </div>
        </div>`;

      // Bind global events
      overlay.querySelector('#wizard-skip')?.addEventListener('click', async () => {
        const { confirmAsync } = await import('../lib/dialog-utils.js');
        if (!(await confirmAsync('Skip setup? You can configure everything later in Settings (⌘,).'))) return;
        finish();
      });
      overlay.querySelector('#wizard-back')?.addEventListener('click', () => {
        // If coming back from AI step and user joined workspace, skip AI step
        if (step === 3 && wsMode === 'join') {
          step = 2;
        } else {
          step--;
        }
        render();
      });
      overlay.querySelector('#wizard-next')?.addEventListener('click', () => {
        // If on workspace step and user joined, skip AI step
        if (step === 2 && wsMode === 'join' && wsJoinResult) {
          step = 4; // Skip AI config — workspace provides it
        } else if (step < TOTAL_STEPS) {
          step++;
        } else {
          finish();
          return;
        }
        render();
      });

      // Step-specific bindings
      _bindStepEvents(step);
    }

    function _bindStepEvents(s) {
      if (s === 1) {
        const nameInput = overlay.querySelector('#wizard-name');
        if (nameInput) {
          nameInput.value = userName;
          nameInput.addEventListener('input', (e) => userName = e.target.value);
          nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); overlay.querySelector('#wizard-next')?.click(); }
          });
          setTimeout(() => nameInput.focus(), 50);
        }
      }

      if (s === 2) {
        // Workspace mode selection
        overlay.querySelector('#wiz-ws-create')?.addEventListener('click', () => { wsMode = 'create'; render(); });
        overlay.querySelector('#wiz-ws-join')?.addEventListener('click', () => { wsMode = 'join'; render(); });
        overlay.querySelector('#wiz-ws-solo')?.addEventListener('click', () => { wsMode = 'solo'; step = 3; render(); });
        overlay.querySelector('#wiz-ws-back-choice')?.addEventListener('click', () => { wsMode = 'solo'; wsError = ''; render(); });

        // Create workspace form
        overlay.querySelector('#wiz-ws-name')?.addEventListener('input', (e) => wsName = e.target.value);

        // Join workspace form
        const codeInput = overlay.querySelector('#wiz-ws-code');
        if (codeInput) {
          codeInput.value = wsInviteCode;
          codeInput.addEventListener('input', (e) => wsInviteCode = e.target.value);
        }

        // Provider toggle for create mode
        overlay.querySelectorAll('.wiz-ws-provider-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            selectedProvider = btn.dataset.provider;
            apiKey = '';
            render();
          });
        });

        // API key input for create mode
        const keyInput = overlay.querySelector('#wiz-ws-key');
        if (keyInput) {
          keyInput.value = apiKey;
          keyInput.addEventListener('input', (e) => apiKey = e.target.value.trim());
        }

        // Create submit
        overlay.querySelector('#wiz-ws-create-btn')?.addEventListener('click', async () => {
          if (!wsName.trim()) { wsError = 'Workspace name is required.'; render(); return; }
          if (!apiKey.trim()) { wsError = 'API key is required.'; render(); return; }
          wsLoading = true; wsError = ''; render();
          try {
            const { createWorkspace } = await import('../lib/workspace.js');
            wsCreateResult = await createWorkspace(wsName.trim(), userName.trim() || 'Admin', selectedProvider, apiKey.trim());
            wsLoading = false;
            wsSuccess = `Created! Invite code: ${wsCreateResult.inviteCode}`;
            keyValidated = true;
            render();
          } catch (e) {
            wsLoading = false;
            wsError = e.message || 'Failed to create workspace.';
            render();
          }
        });

        // Join submit
        overlay.querySelector('#wiz-ws-join-btn')?.addEventListener('click', async () => {
          if (!wsInviteCode.trim()) { wsError = 'Enter an invite code.'; render(); return; }
          wsLoading = true; wsError = ''; render();
          try {
            const { joinWorkspace } = await import('../lib/workspace.js');
            wsJoinResult = await joinWorkspace(wsInviteCode.trim().toUpperCase(), userName.trim() || 'Member');
            wsLoading = false;
            wsSuccess = `Joined "${wsJoinResult.name}"!`;
            render();
          } catch (e) {
            wsLoading = false;
            wsError = e.message || 'Invalid invite code.';
            render();
          }
        });

        // Enter key
        overlay.querySelectorAll('input').forEach(input => {
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const btn = overlay.querySelector('#wiz-ws-create-btn, #wiz-ws-join-btn');
              if (btn && !btn.disabled) btn.click();
            }
          });
        });
      }

      if (s === 3) {
        // AI Provider step (solo mode or verify)
        overlay.querySelectorAll('.wiz-provider-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            selectedProvider = btn.dataset.provider;
            apiKey = '';
            keyValidated = false;
            keyError = '';
            render();
          });
        });

        const keyInput = overlay.querySelector('#wizard-api-key');
        if (keyInput) {
          keyInput.value = apiKey;
          keyInput.addEventListener('input', (e) => { apiKey = e.target.value.trim(); keyValidated = false; keyError = ''; });
          keyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); overlay.querySelector('#wizard-test-key')?.click(); }
          });
          setTimeout(() => keyInput.focus(), 50);
        }

        overlay.querySelector('#wizard-test-key')?.addEventListener('click', async () => {
          if (!apiKey || keyValidating) return;
          keyValidating = true; keyError = ''; render();
          try {
            const isValid = await _testApiKey(apiKey, selectedProvider);
            keyValidating = false;
            if (isValid) {
              keyValidated = true;
              saveAndCache('aiProvider', selectedProvider);
              saveAndCache(selectedProvider === 'gemini' ? 'geminiKey' : 'openaiKey', apiKey);
            } else {
              keyError = 'Invalid API key.';
            }
          } catch (e) {
            keyValidating = false;
            keyError = e.message || 'Validation failed.';
          }
          render();
        });

        overlay.querySelector('#wizard-skip-ai')?.addEventListener('click', () => { step = 4; render(); });
      }

      // Focus next button for steps without inputs
      if (s === 4 || s === 5) {
        setTimeout(() => overlay.querySelector('#wizard-next')?.focus(), 50);
      }
    }

    function _stepContent(s) {
      switch (s) {
        case 1: return _renderWelcome();
        case 2: return _renderWorkspace();
        case 3: return _renderAI();
        case 4: return _renderPreferences();
        case 5: return _renderReady();
        default: return '';
      }
    }

    // ── Step 1: Welcome ────────────────────────────────────────────────────

    function _renderWelcome() {
      return `
        <div class="wiz-step-header">
          <div class="text-5xl mb-2">🎯</div>
          <h2 class="wiz-step-title text-2xl">Welcome to Takus</h2>
          <p class="wiz-step-desc max-w-400">
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
    }

    // ── Step 2: Workspace ──────────────────────────────────────────────────

    function _renderWorkspace() {
      if (!wsMode || wsMode === 'solo') return _renderWorkspaceChoice();
      if (wsMode === 'create') return _renderWorkspaceCreate();
      if (wsMode === 'join') return _renderWorkspaceJoin();
      return '';
    }

    function _renderWorkspaceChoice() {
      return `
        <div class="wiz-step-header">
          ${icons.users(32)}
          <h2 class="wiz-step-title">Workspace</h2>
          <p class="wiz-step-desc">
            Workspaces let you share AI configuration with your team.<br>
            Members get full AI features without needing their own API keys.
          </p>
        </div>
        <div class="wiz-ws-choice">
          <div class="wiz-ws-card" id="wiz-ws-create">
            <div class="wiz-ws-card-icon">🏗️</div>
            <div class="wiz-ws-card-title">Create Workspace</div>
            <div class="wiz-ws-card-desc">Set up AI for your team</div>
          </div>
          <div class="wiz-ws-card" id="wiz-ws-join">
            <div class="wiz-ws-card-icon">🤝</div>
            <div class="wiz-ws-card-title">Join Workspace</div>
            <div class="wiz-ws-card-desc">Enter an invite code</div>
          </div>
        </div>
        <div style="margin-top:var(--space-3);display:flex;flex-direction:column;align-items:center;gap:var(--space-1);">
          <button id="wiz-ws-solo" class="btn btn-primary btn-sm" style="font-size:var(--font-sm);padding:var(--space-2) var(--space-5);">
            Continue solo →
          </button>
          <span style="font-size:var(--font-xs);color:var(--color-text-disabled);max-width:280px;text-align:center;">Recommended · You can create or join a workspace anytime from Settings</span>
        </div>`;
    }

    function _renderWorkspaceCreate() {
      const isGemini = selectedProvider === 'gemini';
      return `
        <div class="wiz-step-header">
          <h2 class="wiz-step-title">Create Workspace</h2>
          <p class="wiz-step-desc">Configure AI for your entire team in one step.</p>
        </div>
        <div class="wiz-ws-form">
          <div>
            <label class="ws-field-label">Workspace Name</label>
            <input class="input" type="text" id="wiz-ws-name" placeholder="e.g. Acme Team" value="${_esc(wsName)}" />
          </div>
          <div>
            <label class="ws-field-label">AI Provider</label>
            <div style="display:flex;gap:var(--space-2);">
              <button class="wiz-ws-provider-btn btn btn-sm ${isGemini ? 'btn-primary' : 'btn-ghost'}" data-provider="gemini"
                style="${!isGemini ? 'border:1px solid var(--color-border);' : ''}">
                Gemini <span style="font-size:10px;opacity:0.7;">(free)</span>
              </button>
              <button class="wiz-ws-provider-btn btn btn-sm ${!isGemini ? 'btn-primary' : 'btn-ghost'}" data-provider="openai"
                style="${isGemini ? 'border:1px solid var(--color-border);' : ''}">
                OpenAI
              </button>
            </div>
          </div>
          <div>
            <label class="ws-field-label">${isGemini ? 'Gemini' : 'OpenAI'} API Key</label>
            <input class="input" type="password" id="wiz-ws-key" placeholder="${isGemini ? 'AIza...' : 'sk-...'}"
              value="${_esc(apiKey)}" autocomplete="off" style="font-family:monospace;font-size:var(--font-xs);" />
            <div style="margin-top:var(--space-1);font-size:var(--font-xs);color:var(--color-text-disabled);">
              Stored server-side. Members never see this key.
            </div>
          </div>
          ${wsError ? `<div class="wiz-ws-status wiz-ws-status-err">⚠ ${_esc(wsError)}</div>` : ''}
          ${wsSuccess ? `<div class="wiz-ws-status wiz-ws-status-ok">✓ ${_esc(wsSuccess)}</div>` : ''}
          <div style="display:flex;gap:var(--space-2);justify-content:space-between;">
            <button id="wiz-ws-back-choice" class="btn btn-ghost btn-sm">← Back</button>
            <button id="wiz-ws-create-btn" class="btn btn-primary btn-sm" ${wsLoading || wsCreateResult ? 'disabled' : ''}>
              ${wsLoading ? 'Creating…' : wsCreateResult ? '✓ Created' : 'Create Workspace'}
            </button>
          </div>
        </div>`;
    }

    function _renderWorkspaceJoin() {
      return `
        <div class="wiz-step-header">
          <h2 class="wiz-step-title">Join Workspace</h2>
          <p class="wiz-step-desc">Enter the invite code from your workspace admin.</p>
        </div>
        <div class="wiz-ws-form">
          <div>
            <label class="ws-field-label">Invite Code</label>
            <input class="input" type="text" id="wiz-ws-code" placeholder="XXXX-1234"
              value="${_esc(wsInviteCode)}" autocomplete="off" spellcheck="false"
              style="font-family:monospace;font-size:var(--font-lg);text-align:center;letter-spacing:2px;text-transform:uppercase;" />
          </div>
          ${wsError ? `<div class="wiz-ws-status wiz-ws-status-err">⚠ ${_esc(wsError)}</div>` : ''}
          ${wsSuccess ? `<div class="wiz-ws-status wiz-ws-status-ok">✓ ${_esc(wsSuccess)}</div>` : ''}
          <div style="display:flex;gap:var(--space-2);justify-content:space-between;">
            <button id="wiz-ws-back-choice" class="btn btn-ghost btn-sm">← Back</button>
            <button id="wiz-ws-join-btn" class="btn btn-primary btn-sm" ${wsLoading || wsJoinResult ? 'disabled' : ''}>
              ${wsLoading ? 'Joining…' : wsJoinResult ? '✓ Joined' : 'Join'}
            </button>
          </div>
        </div>
        <p class="wiz-security-note">
          ${icons.shield(10)} AI keys stay on the server. Your data remains local.
        </p>`;
    }

    // ── Step 3: AI Provider (solo or verify) ────────────────────────────────

    function _renderAI() {
      // If user created a workspace, AI is already configured
      if (wsMode === 'create' && wsCreateResult) {
        return `
          <div class="wiz-step-header">
            ${icons.zap(32)}
            <h2 class="wiz-step-title">AI Provider</h2>
            <p class="wiz-step-desc" style="color:var(--color-success);">
              ✓ AI is configured for your workspace via ${selectedProvider === 'gemini' ? 'Gemini' : 'OpenAI'}.<br>
              All workspace members will get AI features automatically.
            </p>
          </div>
          <div style="margin-top:var(--space-3);font-size:var(--font-sm);color:var(--color-text-secondary);">
            Share your invite code: <code style="background:var(--color-bg-elevated);padding:2px 8px;border-radius:4px;font-weight:var(--weight-bold);color:var(--color-primary-light);letter-spacing:1px;">${wsCreateResult.inviteCode}</code>
          </div>`;
      }

      // Solo mode — show personal key input
      const isGemini = selectedProvider === 'gemini';
      const getKeyLink = isGemini ? 'https://aistudio.google.com/apikey' : 'https://platform.openai.com/api-keys';
      const getKeyLabel = isGemini ? 'Google AI Studio' : 'OpenAI Dashboard';

      return `
        <div class="wiz-step-header">
          ${icons.zap(32)}
          <h2 class="wiz-step-title">AI Provider</h2>
          <p class="wiz-step-desc">
            Add your API key to enable transcription, summaries, and task extraction.
          </p>
        </div>
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
        <div style="max-width:380px;margin:0 auto;text-align:left;">
          <label for="wizard-api-key" style="font-size:var(--font-xs);color:var(--color-text-secondary);display:block;margin-bottom:var(--space-1);">
            ${isGemini ? 'Gemini' : 'OpenAI'} API Key
          </label>
          <div style="display:flex;gap:var(--space-2);">
            <input class="input" type="password" id="wizard-api-key" placeholder="${isGemini ? 'AIza...' : 'sk-...'}"
              autocomplete="off" spellcheck="false" style="flex:1;font-family:monospace;font-size:var(--font-xs);" />
            <button id="wizard-test-key" class="btn ${keyValidated ? 'btn-success' : 'btn-primary'} btn-sm"
              style="white-space:nowrap;min-width:80px;" ${keyValidating ? 'disabled' : ''}>
              ${keyValidating ? 'Validating…' : keyValidated ? '✓ Valid' : 'Test Key'}
            </button>
          </div>
          ${keyError ? `<div style="margin-top:var(--space-2);font-size:var(--font-xs);color:var(--color-error);">⚠ ${_esc(keyError)}</div>` : ''}
          ${keyValidated ? `<div style="margin-top:var(--space-2);font-size:var(--font-xs);color:var(--color-success);">✓ Key saved!</div>` : ''}
          <div style="margin-top:var(--space-3);font-size:var(--font-xs);color:var(--color-text-disabled);">
            Get a free key from <a href="${getKeyLink}" target="_blank" rel="noopener"
              style="color:var(--color-primary-light);text-decoration:underline;">${getKeyLabel}</a>
          </div>
        </div>
        <div style="margin-top:var(--space-4);">
          <button id="wizard-skip-ai" class="btn btn-ghost btn-sm" style="font-size:var(--font-xs);color:var(--color-text-disabled);">
            Skip — I'll add a key later in Settings
          </button>
        </div>
        <p class="wiz-security-note">${icons.shield(10)} API keys are stored locally and never leave your browser.</p>`;
    }

    // ── Step 4: Preferences ────────────────────────────────────────────────

    function _renderPreferences() {
      const aiConfigured = keyValidated || (wsMode === 'create' && wsCreateResult) || (wsMode === 'join' && wsJoinResult);
      const aiLabel = wsJoinResult
        ? `✓ ${wsJoinResult.aiProvider === 'gemini' ? 'Gemini' : 'OpenAI'} (via workspace)`
        : wsCreateResult
          ? `✓ ${selectedProvider === 'gemini' ? 'Gemini' : 'OpenAI'} (workspace)`
          : keyValidated
            ? `✓ ${selectedProvider === 'gemini' ? 'Gemini' : 'OpenAI'} configured`
            : '⚠ Not configured yet';

      return `
        <div class="wiz-step-header">
          ${icons.settings(32)}
          <h2 class="wiz-step-title">Capture Preferences</h2>
          <p class="wiz-step-desc">These defaults can be changed anytime from the Settings tab.</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--space-3);max-width:320px;margin:var(--space-4) auto 0;text-align:left;">
          <div class="wiz-pref-row">
            <span class="wiz-pref-label">Video Quality</span>
            <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);color:var(--color-text-primary);">1080p (default)</span>
          </div>
          <div class="wiz-pref-row">
            <span class="wiz-pref-label">Record Shortcut</span><kbd class="wiz-kbd">R</kbd>
          </div>
          <div class="wiz-pref-row">
            <span class="wiz-pref-label">Pause Shortcut</span><kbd class="wiz-kbd">Space</kbd>
          </div>
          <div class="wiz-pref-row">
            <span class="wiz-pref-label">Stop Shortcut</span><kbd class="wiz-kbd">S</kbd>
          </div>
          <div class="wiz-pref-row" style="border-top:1px solid var(--color-border);padding-top:var(--space-3);margin-top:var(--space-1);">
            <span class="wiz-pref-label">AI Provider</span>
            <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);color:${aiConfigured ? 'var(--color-success)' : 'var(--color-warning)'};">${aiLabel}</span>
          </div>
          ${(wsCreateResult || wsJoinResult) ? `
          <div class="wiz-pref-row">
            <span class="wiz-pref-label">Workspace</span>
            <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);color:var(--color-primary-light);">
              ${_esc(wsCreateResult?.name || wsJoinResult?.name || '')}
            </span>
          </div>` : ''}
        </div>`;
    }

    // ── Step 5: Ready ──────────────────────────────────────────────────────

    function _renderReady() {
      const hasAI = keyValidated || wsCreateResult || wsJoinResult;
      return `
        <div class="wiz-step-header">
          <div class="text-5xl mb-2">🚀</div>
          <h2 class="wiz-step-title text-2xl">You're All Set!</h2>
          <p class="wiz-step-desc max-w-400">Here's how to get started with your first capture:</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--space-3);max-width:360px;margin:var(--space-4) auto 0;">
          ${_actionStep('1', '🎤', 'Capture a meeting', 'Click the record button or press <kbd style="background:var(--color-bg-elevated);padding:1px 6px;border-radius:4px;font-size:var(--font-xs);font-weight:var(--weight-semi);">R</kbd>')}
          ${_actionStep('2', '🤖', 'Let AI process', hasAI
            ? 'Takus will automatically transcribe, summarize, and extract tasks'
            : 'Add your API key in Settings → AI Provider to enable AI processing'
          )}
          ${_actionStep('3', '🔍', 'Search & connect', 'Ask questions across all your knowledge in the Ask tab')}
        </div>`;
    }

    async function finish() {
      try { sessionStorage.removeItem('takus_wizard_state'); } catch { /* ignore */ }
      if (userName.trim()) {
        try { await savePassport({ ownerName: userName.trim() }); } catch { /* non-critical */ }
      }
      if (keyValidated && apiKey && wsMode !== 'create') {
        saveAndCache('aiProvider', selectedProvider);
        saveAndCache(selectedProvider === 'gemini' ? 'geminiKey' : 'openaiKey', apiKey);
      }
      await saveSetting(SETUP_KEY, true).catch(() => {});
      overlay.remove();
      resolve();
    }

    document.body.appendChild(overlay);
    render();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function _testApiKey(key, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    if (provider === 'gemini') {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
        { headers: { 'x-goog-api-key': key }, signal: controller.signal });
      return res.ok;
    } else {
      const res = await fetch('https://api.openai.com/v1/models?limit=1',
        { headers: { 'Authorization': `Bearer ${key}` }, signal: controller.signal });
      return res.ok;
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out.');
    throw e;
  } finally { clearTimeout(timer); }
}

function _esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _featureBadge(icon, title, desc) {
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-1);padding:var(--space-3);background:var(--color-bg-surface);border-radius:var(--radius-md);width:120px;">
    <span class="text-primary">${icon}</span>
    <span class="text-xs fw-semi">${title}</span>
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
