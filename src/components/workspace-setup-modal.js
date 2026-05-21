// Takus — Workspace Setup Modal
// Modal dialog for creating a new workspace or joining an existing one.
// Called from Settings panel "Setup" button.

import { icons } from '../lib/icons.js';
import { trapFocus } from '../lib/dialog-utils.js';
import { esc } from '../lib/utils.js';

/**
 * Open the workspace setup modal.
 * Lets user choose between creating a new workspace or joining an existing one.
 * @returns {Promise<void>}
 */
export function openWorkspaceSetupModal() {
  return new Promise((resolve) => {
    let mode = ''; // '' | 'create' | 'join'
    let wsName = '';
    let adminName = '';
    let aiProvider = 'gemini';
    let aiKey = '';
    let inviteCode = '';
    let memberName = '';
    let loading = false;
    let error = '';
    let success = '';

    const dialog = document.createElement('dialog');
    dialog.className = 'takus-dialog';
    dialog.style.maxWidth = '480px';

    function render() {
      dialog.innerHTML = `
        <div class="takus-dialog-form" style="gap:var(--space-4);">
          ${!mode ? _renderChoice() : mode === 'create' ? _renderCreate() : _renderJoin()}
        </div>`;

      _bindEvents();
      setTimeout(() => {
        const firstInput = dialog.querySelector('input:not([disabled])');
        if (firstInput) firstInput.focus();
      }, 50);
    }

    function _renderChoice() {
      return `
        <div style="text-align:center;margin-bottom:var(--space-2);">
          <div style="font-size:28px;margin-bottom:var(--space-2);">${icons.users(32)}</div>
          <h3 style="font-size:var(--font-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);margin:0;">Workspaces</h3>
          <p style="font-size:var(--font-sm);color:var(--color-text-secondary);margin-top:var(--space-2);line-height:1.5;">
            Create a workspace to share AI configuration with your team.<br>
            Members get full AI features without needing their own API keys.
          </p>
        </div>
        <div class="wiz-ws-choice">
          <div class="wiz-ws-card" id="ws-mode-create">
            <div class="wiz-ws-card-icon">🏗️</div>
            <div class="wiz-ws-card-title">Create New</div>
            <div class="wiz-ws-card-desc">Set up a workspace and invite members</div>
          </div>
          <div class="wiz-ws-card" id="ws-mode-join">
            <div class="wiz-ws-card-icon">🤝</div>
            <div class="wiz-ws-card-title">Join Existing</div>
            <div class="wiz-ws-card-desc">Enter an invite code from your admin</div>
          </div>
        </div>
        <div class="takus-dialog-actions" style="border-top:1px solid var(--color-border);padding-top:var(--space-3);">
          <button id="ws-cancel" class="btn btn-ghost btn-sm">Cancel</button>
        </div>`;
    }

    function _renderCreate() {
      return `
        <div style="text-align:center;margin-bottom:var(--space-2);">
          <h3 style="font-size:var(--font-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);margin:0;">Create Workspace</h3>
          <p style="font-size:var(--font-sm);color:var(--color-text-secondary);margin-top:var(--space-1);">
            Configure AI for your entire team in one step.
          </p>
        </div>
        <div class="wiz-ws-form">
          <div>
            <label class="ws-field-label" for="ws-create-name">Workspace Name</label>
            <input class="input" type="text" id="ws-create-name" placeholder="e.g. Acme Team" 
              value="${esc(wsName)}" autocomplete="off" />
          </div>
          <div>
            <label class="ws-field-label" for="ws-create-admin">Your Name</label>
            <input class="input" type="text" id="ws-create-admin" placeholder="Your display name" 
              value="${esc(adminName)}" autocomplete="name" />
          </div>
          <div>
            <label class="ws-field-label">AI Provider</label>
            <div style="display:flex;gap:var(--space-2);">
              <button class="ws-provider-btn btn btn-sm ${aiProvider === 'gemini' ? 'btn-primary' : 'btn-ghost'}"
                data-provider="gemini" style="${aiProvider !== 'gemini' ? 'border:1px solid var(--color-border);' : ''}">
                Gemini <span style="font-size:10px;opacity:0.7;">(free)</span>
              </button>
              <button class="ws-provider-btn btn btn-sm ${aiProvider === 'openai' ? 'btn-primary' : 'btn-ghost'}"
                data-provider="openai" style="${aiProvider !== 'openai' ? 'border:1px solid var(--color-border);' : ''}">
                OpenAI
              </button>
            </div>
          </div>
          <div>
            <label class="ws-field-label" for="ws-create-key">${aiProvider === 'gemini' ? 'Gemini' : 'OpenAI'} API Key</label>
            <input class="input" type="password" id="ws-create-key" 
              placeholder="${aiProvider === 'gemini' ? 'AIza...' : 'sk-...'}"
              value="${esc(aiKey)}" autocomplete="off" spellcheck="false"
              style="font-family:monospace;font-size:var(--font-xs);" />
            <div style="margin-top:var(--space-1);font-size:var(--font-xs);color:var(--color-text-disabled);">
              This key is stored server-side and shared with all workspace members securely.
            </div>
          </div>
          ${error ? `<div class="wiz-ws-status wiz-ws-status-err">⚠ ${esc(error)}</div>` : ''}
          ${success ? `<div class="wiz-ws-status wiz-ws-status-ok">✓ ${esc(success)}</div>` : ''}
        </div>
        <div class="takus-dialog-actions" style="border-top:1px solid var(--color-border);padding-top:var(--space-3);">
          <button id="ws-back" class="btn btn-ghost btn-sm">← Back</button>
          <button id="ws-create-submit" class="btn btn-primary btn-sm" ${loading ? 'disabled' : ''}>
            ${loading ? 'Creating…' : 'Create Workspace'}
          </button>
        </div>`;
    }

    function _renderJoin() {
      return `
        <div style="text-align:center;margin-bottom:var(--space-2);">
          <h3 style="font-size:var(--font-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);margin:0;">Join Workspace</h3>
          <p style="font-size:var(--font-sm);color:var(--color-text-secondary);margin-top:var(--space-1);">
            Enter the invite code shared by your workspace admin.
          </p>
        </div>
        <div class="wiz-ws-form">
          <div>
            <label class="ws-field-label" for="ws-join-code">Invite Code</label>
            <input class="input" type="text" id="ws-join-code" placeholder="XXXX-1234"
              value="${esc(inviteCode)}" autocomplete="off" spellcheck="false"
              style="font-family:monospace;font-size:var(--font-lg);text-align:center;letter-spacing:2px;text-transform:uppercase;" />
          </div>
          <div>
            <label class="ws-field-label" for="ws-join-name">Your Name</label>
            <input class="input" type="text" id="ws-join-name" placeholder="Your display name"
              value="${esc(memberName)}" autocomplete="name" />
          </div>
          ${error ? `<div class="wiz-ws-status wiz-ws-status-err">⚠ ${esc(error)}</div>` : ''}
          ${success ? `<div class="wiz-ws-status wiz-ws-status-ok">✓ ${esc(success)}</div>` : ''}
        </div>
        <div class="takus-dialog-actions" style="border-top:1px solid var(--color-border);padding-top:var(--space-3);">
          <button id="ws-back" class="btn btn-ghost btn-sm">← Back</button>
          <button id="ws-join-submit" class="btn btn-primary btn-sm" ${loading ? 'disabled' : ''}>
            ${loading ? 'Joining…' : 'Join Workspace'}
          </button>
        </div>`;
    }

    function _bindEvents() {
      // Mode selection
      dialog.querySelector('#ws-mode-create')?.addEventListener('click', () => { mode = 'create'; render(); });
      dialog.querySelector('#ws-mode-join')?.addEventListener('click', () => { mode = 'join'; render(); });

      // Cancel
      dialog.querySelector('#ws-cancel')?.addEventListener('click', () => { dialog.close(); });

      // Back
      dialog.querySelector('#ws-back')?.addEventListener('click', () => { mode = ''; error = ''; success = ''; render(); });

      // Provider toggle
      dialog.querySelectorAll('.ws-provider-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          aiProvider = btn.dataset.provider;
          aiKey = '';
          render();
        });
      });

      // Input tracking
      dialog.querySelector('#ws-create-name')?.addEventListener('input', (e) => wsName = e.target.value);
      dialog.querySelector('#ws-create-admin')?.addEventListener('input', (e) => adminName = e.target.value);
      dialog.querySelector('#ws-create-key')?.addEventListener('input', (e) => aiKey = e.target.value);
      dialog.querySelector('#ws-join-code')?.addEventListener('input', (e) => inviteCode = e.target.value);
      dialog.querySelector('#ws-join-name')?.addEventListener('input', (e) => memberName = e.target.value);

      // Enter key on inputs
      dialog.querySelectorAll('input').forEach(input => {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const submit = dialog.querySelector('#ws-create-submit, #ws-join-submit');
            if (submit && !submit.disabled) submit.click();
          }
        });
      });

      // Create workspace
      dialog.querySelector('#ws-create-submit')?.addEventListener('click', async () => {
        if (!wsName.trim()) { error = 'Workspace name is required.'; render(); return; }
        if (!adminName.trim()) { error = 'Your name is required.'; render(); return; }
        if (!aiKey.trim()) { error = 'API key is required.'; render(); return; }

        loading = true; error = ''; render();
        try {
          const { createWorkspace } = await import('../lib/workspace.js');
          const result = await createWorkspace(wsName.trim(), adminName.trim(), aiProvider, aiKey.trim());
          loading = false;
          success = `Workspace created! Invite code: ${result.inviteCode}`;
          render();
          // Close after a brief pause so user sees the invite code
          setTimeout(() => { dialog.close(); resolve(); window.location.reload(); }, 2000);
        } catch (e) {
          loading = false;
          error = e.message || 'Failed to create workspace.';
          render();
        }
      });

      // Join workspace
      dialog.querySelector('#ws-join-submit')?.addEventListener('click', async () => {
        if (!inviteCode.trim()) { error = 'Invite code is required.'; render(); return; }
        if (!memberName.trim()) { error = 'Your name is required.'; render(); return; }

        loading = true; error = ''; render();
        try {
          const { joinWorkspace } = await import('../lib/workspace.js');
          const result = await joinWorkspace(inviteCode.trim().toUpperCase(), memberName.trim());
          loading = false;
          success = `Joined "${result.name}"! AI is now configured.`;
          render();
          setTimeout(() => { dialog.close(); resolve(); window.location.reload(); }, 2000);
        } catch (e) {
          loading = false;
          error = e.message || 'Failed to join workspace.';
          render();
        }
      });
    }

    const releaseTrap = trapFocus(dialog);
    dialog.addEventListener('close', () => { releaseTrap(); dialog.remove(); });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); dialog.close(); resolve(); });

    document.body.appendChild(dialog);
    render();
    dialog.showModal();
  });
}
