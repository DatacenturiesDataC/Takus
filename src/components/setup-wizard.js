
// First-run guided setup for new users. Multi-step wizard with:
// 1. Welcome screen    2. Workspace (create / join / skip)
// 3. AI provider setup (for workspace creators or solo users)
// 4. Capture preferences
// 5. Ready screen

import { icons } from '../lib/icons.js';
import { getSetting, saveSetting } from '../lib/storage.js';
import { savePassport } from '../apps/passport/index.js';
import { saveAndCache } from '../lib/settings-store.js';
import { trapFocus } from '../lib/dialog-utils.js';

const SETUP_KEY = 'setupComplete';
const TOTAL_STEPS = 5;

/**
 * Check whether the setup wizard has been completed.
 * @returns {Promise<boolean>}
 */
export async function isSetupComplete() {
  const saved = await getSetting(SETUP_KEY).catch(() => null);
  if (saved === true) return true;
  if (!saved) {
    try { return sessionStorage.getItem('takus_setup_complete') === '1'; } catch { return false; }
  }
  return false;
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
    let selectedTone = 'professional'; // tone for live preview

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
        selectedTone = saved.tone || 'professional';
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
      'background:var(--bg-primary);',
    ].join('');

    function render() {
      // Persist non-sensitive wizard state so progress survives refresh
      try {
        sessionStorage.setItem('takus_wizard_state', JSON.stringify({
          step, userName, wsMode, wsName, inviteCode: wsInviteCode, provider: selectedProvider, tone: selectedTone
        }));
      } catch { /* non-critical */ }

      const progress = Math.round((step / TOTAL_STEPS) * 100);
      overlay.innerHTML = `
        <div class="wiz-container">
          <!-- Progress bar -->
          <div class="flex-center gap-3">
            <div class="wiz-progress-track">
              <div class="wiz-progress-fill" style="width:${progress}%;"></div>
            </div>
            <span class="wiz-step-indicator">${step}/${TOTAL_STEPS}</span>
            <button id="wizard-skip" class="btn btn-ghost btn-sm text-xs-disabled">Skip setup</button>
          </div>

          <!-- Step content -->
          <div class="card setup-wizard-card wiz-card">
            ${_stepContent(step)}
          </div>

          <!-- Navigation -->
          <div class="wiz-actions" style="justify-content:${step > 1 ? 'space-between' : 'flex-end'};">
            ${step > 1 ? `<button id="wizard-back" class="btn btn-ghost">${icons.chevronLeft?.(14) || '←'} Back</button>` : ''}
            <button id="wizard-next" class="btn btn-primary min-w-140" ${keyValidating || wsLoading ? 'disabled' : ''}>
              ${step === TOTAL_STEPS ? '🎙️ Record Your First Meeting' : `Next ${icons.chevronRight?.(14) || '→'}`}
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

      if (s === 4) {
        // Tone selector for live preview
        overlay.querySelectorAll('.wiz-tone-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            selectedTone = btn.dataset.tone;
            render();
          });
        });
        setTimeout(() => overlay.querySelector('#wizard-next')?.focus(), 50);
      }

      if (s === 5) {
        // Launch confetti animation on mount
        _launchConfetti(overlay);
        // Explore Dashboard link
        overlay.querySelector('#wizard-explore')?.addEventListener('click', () => finish());
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
          <h2 class="wiz-step-title text-2xl">Your Mind, Amplified</h2>
          <p class="wiz-step-desc max-w-400">
            Takus captures your meetings, extracts what matters, and keeps your team in the loop — all on autopilot.
          </p>
        </div>
        <div class="wiz-benefit-list">
          <div class="wiz-benefit-item"><span class="wiz-benefit-icon">🎙️</span><span>Capture meetings effortlessly</span></div>
          <div class="wiz-benefit-item"><span class="wiz-benefit-icon">🧠</span><span>AI extracts summaries & action items</span></div>
          <div class="wiz-benefit-item"><span class="wiz-benefit-icon">📤</span><span>Share meeting briefs with your team</span></div>
        </div>
        <div class="wiz-input-group">
          <label for="wizard-name" class="wiz-label">What should we call you?</label>
          <input class="input w-full" type="text" id="wizard-name" placeholder="Your name" autocomplete="name" />
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
          <h2 class="wiz-step-title">How will you use Takus?</h2>
          <p class="wiz-step-desc">
            You can always change this later in Settings.
          </p>
        </div>
        <div class="wiz-solo-box">
          <button id="wiz-ws-solo" class="btn btn-primary wiz-btn-primary">
            🧑 Solo — just me
          </button>
          <span class="text-xs-disabled">Recommended · skip workspace setup</span>
        </div>
        <div class="wiz-divider-top">
          <p class="wiz-paragraph">Using Takus with a team?</p>
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
            <div class="flex gap-2">
              <button class="wiz-ws-provider-btn btn btn-sm ${isGemini ? 'btn-primary' : 'btn-ghost'}" data-provider="gemini"
                style="${!isGemini ? 'border:1px solid var(--border-default);' : ''}">
                Gemini <span class="wiz-opacity-70">(free)</span>
              </button>
              <button class="wiz-ws-provider-btn btn btn-sm ${!isGemini ? 'btn-primary' : 'btn-ghost'}" data-provider="openai"
                style="${isGemini ? 'border:1px solid var(--border-default);' : ''}">
                OpenAI
              </button>
            </div>
          </div>
          <div>
            <label class="ws-field-label">${isGemini ? 'Gemini' : 'OpenAI'} API Key</label>
            <input class="input font-mono text-xs" type="password" id="wiz-ws-key" placeholder="${isGemini ? 'AIza...' : 'sk-...'}"
              value="${_esc(apiKey)}" autocomplete="off" />
            <div class="wiz-subtext">
              Stored server-side. Members never see this key.
            </div>
          </div>
          ${wsError ? `<div class="wiz-ws-status wiz-ws-status-err">⚠ ${_esc(wsError)}</div>` : ''}
          ${wsSuccess ? `<div class="wiz-ws-status wiz-ws-status-ok">✓ ${_esc(wsSuccess)}</div>` : ''}
          <div class="wiz-actions-between">
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
            <input class="input wiz-code-input" type="text" id="wiz-ws-code" placeholder="XXXX-1234"
              value="${_esc(wsInviteCode)}" autocomplete="off" spellcheck="false" />
          </div>
          ${wsError ? `<div class="wiz-ws-status wiz-ws-status-err">⚠ ${_esc(wsError)}</div>` : ''}
          ${wsSuccess ? `<div class="wiz-ws-status wiz-ws-status-ok">✓ ${_esc(wsSuccess)}</div>` : ''}
          <div class="wiz-actions-between">
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
            <p class="wiz-step-desc wiz-success-text">
              ✓ AI is configured for your workspace via ${selectedProvider === 'gemini' ? 'Gemini' : 'OpenAI'}.<br>
              All workspace members will get AI features automatically.
            </p>
          </div>
          <div class="wiz-invite-wrap">
            Share your invite code: <code class="wiz-invite-code">${wsCreateResult.inviteCode}</code>
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
            Takus uses AI to transcribe your meetings, generate smart summaries, and extract action items automatically.
            Just paste an API key below and you're ready to go.
          </p>
        </div>
        <div class="wiz-actions-center">
          <button class="wiz-provider-btn btn ${isGemini ? 'btn-primary' : 'btn-ghost'} wiz-provider-card" data-provider="gemini"
            style="${!isGemini ? 'border:1px solid var(--border-default);' : ''}">
            Gemini <span class="wiz-provider-badge">Free tier</span>
          </button>
          <button class="wiz-provider-btn btn ${!isGemini ? 'btn-primary' : 'btn-ghost'} wiz-provider-card" data-provider="openai"
            style="${isGemini ? 'border:1px solid var(--border-default);' : ''}">
            OpenAI <span class="wiz-provider-badge">Best accuracy</span>
          </button>
        </div>
        <div class="wiz-input-group-wide">
          <label for="wizard-api-key" class="wiz-label">
            ${isGemini ? 'Gemini' : 'OpenAI'} API Key
          </label>
          <div class="flex gap-2">
            <input class="input flex-1 font-mono text-xs" type="password" id="wizard-api-key" placeholder="${isGemini ? 'AIza...' : 'sk-...'}"
              autocomplete="off" spellcheck="false" />
            <button id="wizard-test-key" class="btn ${keyValidated ? 'btn-success' : 'btn-primary'} btn-sm wiz-btn-validate"
              ${keyValidating ? 'disabled' : ''}>
              ${keyValidating ? 'Validating…' : keyValidated ? '✓ Valid' : 'Test Key'}
            </button>
          </div>
          ${keyError ? `<div class="wiz-error-text">⚠ ${_esc(keyError)}</div>` : ''}
          ${keyValidated ? `<div class="wiz-success-text-sm">✓ Key saved!</div>` : ''}
          <div class="mt-3">
            <a href="${getKeyLink}" target="_blank" rel="noopener" class="wiz-link-accent">
              Get your API key in 2 minutes →
            </a>
          </div>
        </div>
        <div class="mt-4">
          <button id="wizard-skip-ai" class="btn btn-ghost btn-sm text-xs-disabled">
            Skip for now
          </button>
          <p class="text-xs-disabled text-center mx-auto mt-2" style="max-width:300px;">
            No worries — you can add your key anytime in Settings → AI Provider.
          </p>
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

      // Inline _buildGreeting logic for live preview
      const previewGreeting = _wizBuildGreeting(userName, selectedTone);

      return `
        <div class="wiz-step-header">
          ${icons.settings(32)}
          <h2 class="wiz-step-title">Capture Preferences</h2>
          <p class="wiz-step-desc">These defaults can be changed anytime from the Settings tab.</p>
        </div>
        <div class="wiz-step-content wiz-step-content-left">
          <!-- Live greeting preview card -->
          <div class="wiz-preview-card">
            <div class="wiz-preview-header">Live Preview</div>
            <div class="wiz-preview-title">${_esc(previewGreeting)}</div>
            <div class="wiz-preview-date">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
          <!-- Tone selector -->
          <div>
            <span class="wiz-pref-label mb-2" style="display:block;">Greeting Tone</span>
            <div class="flex gap-1 flex-wrap">
              ${['professional', 'casual', 'academic', 'concise'].map(t => `
                <button class="wiz-tone-btn btn btn-sm ${selectedTone === t ? 'btn-primary' : 'btn-ghost'}" data-tone="${t}"
                  style="text-transform:capitalize;${selectedTone !== t ? 'border:1px solid var(--border-default);' : ''}">
                  ${t}
                </button>
              `).join('')}
            </div>
          </div>
          <div class="wiz-pref-row">
            <span class="wiz-pref-label">Video Quality</span>
            <span class="font-semi text-sm">1080p (default)</span>
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
          <div class="wiz-pref-row wiz-pref-row-border">
            <span class="wiz-pref-label">AI Provider</span>
            <span class="font-semi text-sm" style="color:${aiConfigured ? 'var(--color-success)' : 'var(--color-warning)'};">${aiLabel}</span>
          </div>
          ${(wsCreateResult || wsJoinResult) ? `
          <div class="wiz-pref-row">
            <span class="wiz-pref-label">Workspace</span>
            <span class="font-semi text-sm text-primary">
              ${_esc(wsCreateResult?.name || wsJoinResult?.name || '')}
            </span>
          </div>` : ''}
        </div>`;
    }

    // ── Step 5: Ready ──────────────────────────────────────────────────────

    function _renderReady() {
      const hasAI = keyValidated || wsCreateResult || wsJoinResult;
      return `
        <div class="wiz-confetti-container" id="wiz-confetti-area"></div>
        <div class="wiz-step-header">
          <div class="text-5xl mb-2">🚀</div>
          <h2 class="wiz-step-title text-2xl">You're All Set!</h2>
          <p class="wiz-step-desc max-w-400">Here's how to get started with your first capture:</p>
        </div>
        <div class="wiz-step-content">
          ${_actionStep('1', '🎤', 'Capture a meeting', 'Click the record button or press <kbd class="wiz-kbd">R</kbd>')}
          ${_actionStep('2', '🤖', 'Let AI process', hasAI
            ? 'Takus will automatically transcribe, summarize, and extract tasks'
            : 'Add your API key in Settings → AI Provider to enable AI processing'
          )}
          ${_actionStep('3', '🔍', 'Search & connect', 'Ask questions across all your knowledge in the Ask tab')}
        </div>
        <div class="mt-3">
          <button id="wizard-explore" class="btn btn-ghost btn-sm text-xs text-secondary">
            Or explore the dashboard first →
          </button>
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
      try {
        await saveSetting(SETUP_KEY, true);
      } catch {
        try { sessionStorage.setItem('takus_setup_complete', '1'); } catch { /* private browsing */ }
      }
      overlay.remove();
      resolve();
    }

    document.body.appendChild(overlay);
    const cleanupTrap = trapFocus(overlay);

    // Escape key to skip wizard (with confirmation)
    function _onEscape(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        overlay.querySelector('#wizard-skip')?.click();
      }
    }
    document.addEventListener('keydown', _onEscape);

    // Store original finish for cleanup
    const _origFinish = finish;
    finish = async function () {
      cleanupTrap();
      document.removeEventListener('keydown', _onEscape);
      return _origFinish();
    };

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
  return `<div class="wiz-capability-card">
    <span class="text-primary">${icon}</span>
    <span class="text-xs fw-semi">${title}</span>
    <span class="text-10-disabled">${desc}</span>
  </div>`;
}

function _actionStep(num, emoji, title, desc) {
  return `<div class="wiz-feature-card">
    <div class="wiz-step-badge">${num}</div>
    <div class="flex-1 min-w-0">
      <div class="wiz-step-title">${emoji} ${title}</div>
      <div class="wiz-step-desc">${desc}</div>
    </div>
  </div>`;
}

/**
 * Inline greeting builder for the live preview (mirrors _buildGreeting from greeting-engine.js).
 * Avoids importing the engine just for the wizard preview.
 */
function _wizBuildGreeting(name, tone) {
  const h = new Date().getHours();
  const timeOfDay = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  const timeGreetings = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' };
  const base = timeGreetings[timeOfDay];
  const n = (name || '').trim();

  switch (tone) {
    case 'casual':
      return n ? `Hey ${n}! 👋` : 'Hey there! 👋';
    case 'academic':
      return n ? `${base}, ${n}.` : `${base}.`;
    case 'concise': {
      const short = base.replace('Good ', '');
      const cap = short.charAt(0).toUpperCase() + short.slice(1);
      return n ? `${cap}, ${n}.` : `${cap}.`;
    }
    case 'professional':
    default:
      return n ? `${base}, ${n}.` : `${base}.`;
  }
}

/**
 * Launch confetti CSS animation — creates ~20 small colored squares
 * that fall from top of the card.
 */
function _launchConfetti(overlay) {
  const area = overlay.querySelector('#wiz-confetti-area');
  if (!area) return;
  const colors = ['#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#3b82f6', '#f97316', '#14b8a6', '#e879f9'];
  for (let i = 0; i < 24; i++) {
    const piece = document.createElement('div');
    piece.className = 'wiz-confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    piece.style.animationDuration = `${1.2 + Math.random() * 1.0}s`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    area.appendChild(piece);
  }
  // Clean up after animation ends
  setTimeout(() => { if (area) area.innerHTML = ''; }, 3000);
}
