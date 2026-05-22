// Takus — Workspace Management Panel
// Renders workspace info, invite code, member list, and admin controls.
// Displayed in the Settings tab when the user is part of a workspace.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { confirmAsync } from '../lib/dialog-utils.js';

/**
 * Render the workspace management panel into a container.
 * Shows workspace name, invite code, AI provider status, and admin controls.
 *
 * @param {HTMLElement} container - DOM element to render into
 * @param {object} workspace - Workspace config from getWorkspaceCached()
 * @param {object} callbacks - { onLeave, onUpdate, onRegenerateInvite, onRefresh }
 */
export function renderWorkspacePanel(container, workspace, callbacks = {}) {
  if (!workspace) {
    container.innerHTML = '';
    return;
  }

  const isAdmin = !!workspace.adminToken;
  const provider = workspace.aiProvider === 'gemini' ? 'Gemini' : 'OpenAI';

  container.innerHTML = `
    <div class="ws-panel">
      <div class="ws-header">
        <div class="ws-header-left">
          <div class="ws-icon">${icons.users(20)}</div>
          <div>
            <h3 class="ws-name">${esc(workspace.name || 'Workspace')}</h3>
            <span class="ws-role-badge ${isAdmin ? 'ws-role-admin' : 'ws-role-member'}">
              ${isAdmin ? '👑 Admin' : '👤 Member'}
            </span>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm ws-refresh-btn" id="ws-refresh" title="Refresh">
          ${icons.refresh?.(14) || '↻'}
        </button>
      </div>

      <!-- AI Provider Status -->
      <div class="ws-status-card">
        <div class="ws-status-row">
          <span class="ws-status-label">${icons.zap(14)} AI Provider</span>
          <span class="ws-status-value ws-status-active">✓ ${esc(provider)}</span>
        </div>
        <div class="ws-status-row">
          <span class="ws-status-label">${icons.shield(14)} Key Storage</span>
          <span class="ws-status-value">Server-side (secure)</span>
        </div>
      </div>

      <!-- Invite Code -->
      <div class="ws-invite-section">
        <label class="ws-invite-label">Invite Code</label>
        <div class="ws-invite-row">
          <code class="ws-invite-code" id="ws-invite-display">${esc(workspace.inviteCode || '—')}</code>
          <button class="btn btn-ghost btn-sm" id="ws-copy-invite" title="Copy invite code">
            ${icons.copy?.(14) || '📋'}
          </button>
          ${isAdmin ? `
            <button class="btn btn-ghost btn-sm" id="ws-regen-invite" title="Generate new code">
              ${icons.refresh?.(14) || '↻'}
            </button>
          ` : ''}
        </div>
        <p class="ws-invite-help">Share this code with team members to join your workspace.</p>
      </div>

      ${isAdmin ? `
      <!-- Admin Controls -->
      <div class="ws-admin-section">
        <h4 class="ws-section-title">Admin Settings</h4>

        <div class="ws-admin-field">
          <label for="ws-admin-name" class="ws-field-label">Workspace Name</label>
          <div style="display:flex;gap:var(--space-2);">
            <input class="input" type="text" id="ws-admin-name" value="${esc(workspace.name)}" 
              style="flex:1;font-size:var(--font-sm);" />
            <button class="btn btn-primary btn-sm" id="ws-save-name">Save</button>
          </div>
        </div>

        <div class="ws-admin-field">
          <label class="ws-field-label">Update AI Provider</label>
          <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2);">
            <button class="ws-provider-btn btn btn-sm ${workspace.aiProvider === 'gemini' ? 'btn-primary' : 'btn-ghost'}" 
              data-provider="gemini" id="ws-provider-gemini">
              Gemini
            </button>
            <button class="ws-provider-btn btn btn-sm ${workspace.aiProvider === 'openai' ? 'btn-primary' : 'btn-ghost'}" 
              data-provider="openai" id="ws-provider-openai">
              OpenAI
            </button>
          </div>
          <div style="display:flex;gap:var(--space-2);">
            <input class="input" type="password" id="ws-admin-key" placeholder="New API key…" 
              style="flex:1;font-family:monospace;font-size:var(--font-xs);" autocomplete="off" />
            <button class="btn btn-primary btn-sm" id="ws-save-key">Update Key</button>
          </div>
        </div>
      </div>
      ` : ''}

      <!-- Leave Workspace -->
      <div class="ws-leave-section">
        <button class="btn btn-ghost btn-sm ws-leave-btn" id="ws-leave">
          ${isAdmin ? '🗑️ Delete Workspace' : '👋 Leave Workspace'}
        </button>
      </div>
    </div>
  `;

  // ── Event Bindings ───────────────────────────────────────────────────

  // Copy invite code
  container.querySelector('#ws-copy-invite')?.addEventListener('click', () => {
    const code = workspace.inviteCode;
    if (code) {
      navigator.clipboard?.writeText(code).then(() => {
        const btn = container.querySelector('#ws-copy-invite');
        if (btn) { btn.innerHTML = '✓'; setTimeout(() => btn.innerHTML = icons.copy?.(14) || '📋', 1500); }
      }).catch(() => {});
    }
  });

  // Refresh
  container.querySelector('#ws-refresh')?.addEventListener('click', () => {
    callbacks.onRefresh?.();
  });

  // Regenerate invite
  container.querySelector('#ws-regen-invite')?.addEventListener('click', async () => {
    try {
      const result = await callbacks.onRegenerateInvite?.();
      if (result?.inviteCode) {
        const display = container.querySelector('#ws-invite-display');
        if (display) display.textContent = result.inviteCode;
      }
    } catch (e) {
      console.warn('[Workspace] Invite regeneration failed:', e);
    }
  });

  // Save name (admin)
  container.querySelector('#ws-save-name')?.addEventListener('click', async () => {
    const name = container.querySelector('#ws-admin-name')?.value?.trim();
    if (name) {
      try { await callbacks.onUpdate?.({ name }); } catch { /* toast handled upstream */ }
    }
  });

  // Provider toggle (admin)
  let selectedProvider = workspace.aiProvider || 'gemini';
  container.querySelectorAll('.ws-provider-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedProvider = btn.dataset.provider;
      container.querySelector('#ws-provider-gemini')?.classList.toggle('btn-primary', selectedProvider === 'gemini');
      container.querySelector('#ws-provider-gemini')?.classList.toggle('btn-ghost', selectedProvider !== 'gemini');
      container.querySelector('#ws-provider-openai')?.classList.toggle('btn-primary', selectedProvider === 'openai');
      container.querySelector('#ws-provider-openai')?.classList.toggle('btn-ghost', selectedProvider !== 'openai');
    });
  });

  // Save AI key (admin)
  container.querySelector('#ws-save-key')?.addEventListener('click', async () => {
    const key = container.querySelector('#ws-admin-key')?.value?.trim();
    if (key) {
      try {
        await callbacks.onUpdate?.({ aiProvider: selectedProvider, aiKey: key });
        const input = container.querySelector('#ws-admin-key');
        if (input) input.value = '';
      } catch { /* toast handled upstream */ }
    }
  });

  // Leave workspace
  container.querySelector('#ws-leave')?.addEventListener('click', async () => {
    const action = isAdmin ? 'delete this workspace' : 'leave this workspace';
    if (await confirmAsync(`Are you sure you want to ${action}? This cannot be undone.`, { destructive: true })) {
      callbacks.onLeave?.();
    }
  });
}

/**
 * Render a compact workspace badge for the header area.
 * Shows workspace name and a colored dot.
 *
 * @param {object|null} workspace
 * @returns {string} HTML string
 */
export function renderWorkspaceBadge(workspace) {
  if (!workspace) return '';
  return `
    <div class="ws-badge" title="${esc(workspace.name || 'Workspace')}">
      <span class="ws-badge-dot"></span>
      <span class="ws-badge-name">${esc(workspace.name || 'Workspace')}</span>
    </div>
  `;
}
