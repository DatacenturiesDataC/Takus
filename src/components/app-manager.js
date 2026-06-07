// Takus — App Manager Panel (App Platform UI)
// Renders the app management interface: app tiles, activation toggles, and per-app settings.
// This replaces the previous "Apps" tab with a full app management experience.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import {
  getAllApps, isActive,
  activateApp, deactivateApp, getAppSettings,
} from '../lib/app-manager.js';
import { toast } from './toast.js';
import { confirmAsync, trapFocus } from '../lib/dialog-utils.js';

/**
 * Render the App Manager panel into a container.
 * Shows all registered apps with their activation status and settings access.
 *
 * @param {HTMLElement} container
 */
export async function renderAppManager(container) {
  const apps = getAllApps();
  const activeCount = apps.filter(a => isActive(a.id)).length;

  // Group by category
  const core    = apps.filter(a => a.category === 'core');
  const builtIn = apps.filter(a => a.category === 'built-in');
  const community = apps.filter(a => a.category === 'community');

  container.innerHTML = `
    <div class="card card-compact animate-in" id="app-manager-root">
      <div style="padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-4);">

        <!-- Header -->
        <div class="flex-between">
          <div>
            <span class="set-section-head">
              ${icons.grid(14)} App Manager
            </span>
            <span class="rd-text-sm text-muted" >
              ${activeCount} of ${apps.length} apps active
            </span>
          </div>
        </div>

        ${core.length ? _renderSection('Core', core, '🔒 Core apps are always active and cannot be deactivated.') : ''}
        ${builtIn.length ? _renderSection('Built-in Apps', builtIn) : ''}
        ${community.length ? _renderSection('Community Apps', community) : ''}

        <!-- Info -->
        <div style="font-size:var(--text-2xs);color:var(--text-disabled);display:flex;align-items:center;gap:4px;">
          ${icons.shield(10)} Apps run locally in your browser. No external code is loaded.
        </div>
      </div>
    </div>`;

  // ── Bind interactions ─────────────────────────────────────────────────
  _bindToggleButtons(container);
  _bindSettingsButtons(container);
  _bindTileHover(container);
}

// ── Section renderer ──────────────────────────────────────────────────────

function _renderSection(title, apps, subtitle) {
  return `
    <div>
      <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);">
        <div style="font-size:var(--text-2xs);font-weight:var(--weight-semibold);color:var(--text-disabled);text-transform:uppercase;letter-spacing:0.5px;">
          ${esc(title)}
        </div>
        ${subtitle ? `<div class="text-9-disabled ml-auto">${esc(subtitle)}</div>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:var(--space-3);">
        ${apps.map(app => _renderAppTile(app)).join('')}
      </div>
    </div>`;
}

// ── App tile renderer ─────────────────────────────────────────────────────

function _renderAppTile(app) {
  const active = isActive(app.id);
  const isCore = app.category === 'core';
  const settings = getAppSettings(app.id);
  const hasSettings = app.getSettingsSchema().length > 0;

  const borderColor = active ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.08)';
  const bgColor = active ? 'rgba(139,92,246,0.04)' : 'rgba(255,255,255,0.02)';

  return `
    <div class="app-tile" data-app-id="${esc(app.id)}" style="
      border:1px solid ${borderColor};
      border-radius:var(--radius-lg);
      padding:var(--space-3);
      background:${bgColor};
      cursor:pointer;
      transition:all 0.2s ease;
      position:relative;
      overflow:hidden;
    ">
      <!-- Header Row -->
      <div class="flex-center" style="margin-bottom:6px;">
        <span style="font-size:1.25rem;flex-shrink:0;">${esc(app.icon)}</span>
        <div class="flex-1 min-w-0">
          <div style="font-size:var(--text-2xs);font-weight:var(--weight-semibold);color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${esc(app.name)}
          </div>
          <div class="text-9-disabled">v${esc(app.version)}</div>
        </div>
      </div>

      <!-- Description -->
      <div style="font-size:var(--text-2xs);color:var(--text-disabled);margin-bottom:8px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
        ${esc(app.description)}
      </div>

      <!-- Footer: Status + Actions -->
      <div class="flex-between">
        <div class="flex-center text-10" style="gap:4px;">
          <span style="
            width:6px;height:6px;border-radius:50%;
            background:${active ? 'var(--color-success)' : 'var(--text-disabled)'};
            display:inline-block;flex-shrink:0;
          "></span>
          <span style="color:${active ? 'var(--color-success)' : 'var(--text-disabled)'};">
            ${active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div class="flex-center">
          ${hasSettings ? `
            <button class="btn btn-ghost btn-icon btn-sm app-settings-btn btn-icon-sm" data-app-id="${esc(app.id)}" title="Settings" >
              ${icons.settings(12)}
            </button>
          ` : ''}
          ${!isCore ? `
            <button class="btn btn-ghost btn-icon btn-sm app-toggle-btn btn-icon-sm" data-app-id="${esc(app.id)}" title="${active ? 'Deactivate' : 'Activate'}" >
              ${active ? icons.x(12) : icons.check(12)}
            </button>
          ` : ''}
        </div>
      </div>

      ${isCore ? `<div style="position:absolute;top:6px;right:6px;font-size:var(--text-2xs);padding:1px 5px;border-radius:8px;background:rgba(139,92,246,0.12);color:var(--accent-hover);font-weight:600;">Core</div>` : ''}
    </div>`;
}

// ── Event bindings ────────────────────────────────────────────────────────

function _bindToggleButtons(container) {
  container.querySelectorAll('.app-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const appId = btn.dataset.appId;
      const active = isActive(appId);

      btn.disabled = true;
      try {
        if (active) {
          await deactivateApp(appId);
          toast.info(`${appId} deactivated`);
        } else {
          await activateApp(appId);
          toast.success(`${appId} activated`);
        }
        // Re-render
        await renderAppManager(container.closest('#app-manager-root')?.parentElement || container);
      } catch (err) {
        toast.error('Failed', err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function _bindSettingsButtons(container) {
  container.querySelectorAll('.app-settings-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const appId = btn.dataset.appId;
      _showAppSettingsModal(appId);
    });
  });
}

function _bindTileHover(container) {
  container.querySelectorAll('.app-tile').forEach(tile => {
    tile.addEventListener('mouseenter', () => {
      tile.style.transform = 'translateY(-2px)';
      tile.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    });
    tile.addEventListener('mouseleave', () => {
      tile.style.transform = '';
      tile.style.boxShadow = '';
    });
  });
}

// ── App Settings Modal ────────────────────────────────────────────────────

async function _showAppSettingsModal(appId) {
  const { getApp, setAppSetting, resetAppSettings } = await import('../lib/app-manager.js');
  const app = getApp(appId);
  if (!app) return;

  document.getElementById('app-settings-overlay')?.remove();

  const schema = app.getSettingsSchema();
  const current = getAppSettings(appId);

  const overlay = document.createElement('div');
  overlay.id = 'app-settings-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${app.name} settings`);
  overlay.style.cssText = [
    'position:fixed;inset:0;',
    'background:rgba(0,0,0,0.7);',
    'display:flex;align-items:flex-start;justify-content:center;',
    'z-index:var(--z-modal);',
    'padding:var(--space-4);',
    'overflow-y:auto;',
    'backdrop-filter:blur(6px);',
  ].join('');

  overlay.innerHTML = `
    <div class="card animate-in" style="width:100%;max-width:480px;margin-top:var(--space-8);">
      <div class="card-header sticky-header" >
        <h3 class="flex-center gap-2">
          <span style="font-size:1.25rem;">${esc(app.icon)}</span>
          ${esc(app.name)} Settings
        </h3>
        <button class="btn btn-ghost btn-icon btn-sm" id="app-settings-close" aria-label="Close">${icons.x(16)}</button>
      </div>
      <div class="pad-stack">
        ${schema.map(field => _renderSettingField(field, current)).join('')}

        <div style="display:flex;justify-content:space-between;margin-top:var(--space-2);">
          <button class="btn btn-ghost btn-sm text-danger" id="app-settings-reset" >Reset to Defaults</button>
          <button class="btn btn-primary btn-sm" id="app-settings-save">Save Settings</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const cleanupTrap = trapFocus(overlay);
  const close = () => { cleanupTrap(); overlay.remove(); document.removeEventListener('keydown', escHandler); };
  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escHandler);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#app-settings-close').addEventListener('click', close);

  // Save
  overlay.querySelector('#app-settings-save')?.addEventListener('click', async () => {
    for (const field of schema) {
      const el = overlay.querySelector(`#app-setting-${esc(field.key)}`);
      if (!el) continue;
      let value;
      if (field.type === 'toggle') {
        value = el.checked;
      } else if (field.type === 'number') {
        value = parseFloat(el.value) || 0;
      } else {
        value = el.value;
      }
      await setAppSetting(appId, field.key, value);
    }
    toast.success('Settings saved', `${app.name} settings updated.`);
    close();
  });

  // Reset
  overlay.querySelector('#app-settings-reset')?.addEventListener('click', async () => {
    if (!(await confirmAsync(`Reset all ${app.name} settings to defaults?`, { confirmLabel: 'Reset', destructive: true }))) return;
    await resetAppSettings(appId);
    toast.info('Settings reset', `${app.name} settings restored to defaults.`);
    close();
  });
}

function _renderSettingField(field, current) {
  const value = current[field.key] ?? field.defaultValue ?? '';
  const desc = field.description ? `<div class="text-10-disabled mt-4">${esc(field.description)}</div>` : '';

  switch (field.type) {
    case 'toggle':
      return `
        <div class="input-group" style="flex-direction:row;align-items:center;justify-content:space-between;">
          <div>
            <label for="app-setting-${esc(field.key)}">${esc(field.label)}</label>
            ${desc}
          </div>
          <input type="checkbox" id="app-setting-${esc(field.key)}" ${value ? 'checked' : ''} />
        </div>`;

    case 'select':
      return `
        <div class="input-group">
          <label for="app-setting-${esc(field.key)}">${esc(field.label)}</label>
          <select class="input" id="app-setting-${esc(field.key)}">
            ${(field.options || []).map(o =>
              `<option value="${esc(String(o.value))}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`
            ).join('')}
          </select>
          ${desc}
        </div>`;

    case 'textarea':
      return `
        <div class="input-group">
          <label for="app-setting-${esc(field.key)}">${esc(field.label)}</label>
          <textarea class="input" id="app-setting-${esc(field.key)}" rows="3">${esc(String(value))}</textarea>
          ${desc}
        </div>`;

    case 'number':
      return `
        <div class="input-group">
          <label for="app-setting-${esc(field.key)}">${esc(field.label)}</label>
          <input class="input" type="number" id="app-setting-${esc(field.key)}" value="${esc(String(value))}" />
          ${desc}
        </div>`;

    default: // text, password
      return `
        <div class="input-group">
          <label for="app-setting-${esc(field.key)}">${esc(field.label)}</label>
          <input class="input" type="${field.type || 'text'}" id="app-setting-${esc(field.key)}" value="${esc(String(value))}" autocomplete="off" />
          ${desc}
        </div>`;
  }
}
