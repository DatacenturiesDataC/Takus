
// Pure rendering helpers extracted from settings-panel.js.

import { esc } from '../lib/utils.js';
import { icons } from '../lib/icons.js';
import { toast } from './toast.js';

// ── Feedback ────────────────────────────────────────────────────────────────

/**
 * Get an emoji icon for a feedback category.
 * @param {string} category
 * @returns {string}
 */
export function feedbackIcon(category) {
  switch (category) {
    case 'bug': return '🐛';
    case 'feature_request': return '✨';
    case 'ux': return '🎨';
    default: return '💬';
  }
}

// ── Auto-Run Rules ──────────────────────────────────────────────────────────

/**
 * Generate a human-readable label for an Auto-Run rule.
 * @param {object} rule
 * @returns {string}
 */
export function ruleLabel(rule) {
  const fieldLabels = { type: 'Type', source: 'Source', title: 'Title', participant: 'Participant' };
  const opLabels = { equals: 'is', contains: 'contains', startsWith: 'starts with' };
  return `${fieldLabels[rule.field] || rule.field} ${opLabels[rule.operator] || rule.operator} "${rule.value}"`;
}

/**
 * Render Auto-Run rules list and presets into the settings panel.
 * @param {HTMLElement} root - Settings container
 */
export function renderAutoRuns(root) {
  Promise.all([
    import('../lib/auto-runs.js'),
    import('../lib/app-manager.js'),
  ]).then(([autoRunsMod, appManagerMod]) => {
    const { getAutoRuns, addAutoRun, removeAutoRun, toggleAutoRun } = autoRunsMod;
    const { getAutoRunPresets } = appManagerMod;
    const rulesSlot = root.querySelector('#auto-runs-slot');
    const presetsSlot = root.querySelector('#auto-runs-presets-slot');
    if (!rulesSlot) return;

    function render() {
      const rules = getAutoRuns();

      if (!rules.length) {
        rulesSlot.innerHTML = `<div class="text-xs text-disabled" style="padding:var(--space-2);">No rules configured. Items will be held in the inbox.</div>`;
      } else {
        rulesSlot.innerHTML = rules.map(r => `
          <div style="display:flex;align-items:center;gap:var(--space-2);padding:6px var(--space-3);border-radius:var(--radius-sm);background:rgba(255,255,255,0.02);" data-rule="${r.id}">
            <input type="checkbox" data-rule-toggle="${r.id}" ${r.enabled ? 'checked' : ''} style="flex-shrink:0;accent-color:var(--color-primary);" title="${r.enabled ? 'Disable rule' : 'Enable rule'}" />
            <div class="flex-1 min-w-0">
              <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:${r.enabled ? 'var(--color-text-secondary)' : 'var(--color-text-disabled)'}">${esc(r.label || ruleLabel(r))}</div>
              <div class="text-10-disabled">${esc(r.field)} ${r.operator} "${esc(r.value)}"</div>
            </div>
            <button class="btn btn-ghost btn-icon btn-sm" data-rule-delete="${r.id}" title="Remove rule">${icons.trash(12)}</button>
          </div>
        `).join('');
      }

      rulesSlot.querySelectorAll('[data-rule-toggle]').forEach(input => {
        input.addEventListener('change', () => {
          toggleAutoRun(input.dataset.ruleToggle);
          render();
          toast.success('Rule updated', input.checked ? 'Rule enabled' : 'Rule disabled');
        });
      });
      rulesSlot.querySelectorAll('[data-rule-delete]').forEach(btn => {
        btn.addEventListener('click', () => {
          removeAutoRun(btn.dataset.ruleDelete);
          render();
          toast.success('Rule removed', 'Auto-Run rule deleted');
        });
      });

      if (presetsSlot) {
        const presets = getAutoRunPresets();
        const existingValues = new Set(rules.map(r => `${r.field}:${r.operator}:${r.value.toLowerCase()}`));
        const available = presets.filter(p => !existingValues.has(`${p.field}:${p.operator}:${p.value.toLowerCase()}`));

        if (available.length) {
          presetsSlot.innerHTML = `
            <div style="font-size:10px;color:var(--color-text-disabled);margin-bottom:var(--space-2);">Suggested rules:</div>
            ${available.map((p, i) => `
              <button class="btn btn-ghost btn-sm" data-preset="${i}" style="font-size:var(--font-xs);margin-bottom:4px;text-align:left;display:flex;align-items:center;gap:var(--space-2);width:100%;justify-content:flex-start;">
                ${icons.plus(10)} ${p.appIcon ? `<span class="text-11" title="${esc(p.appName || p.appId)}">${p.appIcon}</span>` : ''} ${esc(p.description)}
              </button>
            `).join('')}`;
          presetsSlot.querySelectorAll('[data-preset]').forEach(btn => {
            btn.addEventListener('click', () => {
              const idx = parseInt(btn.dataset.preset, 10);
              const preset = available[idx];
              if (preset) {
                addAutoRun(preset);
                render();
                toast.success('Rule added', preset.label || preset.description);
              }
            });
          });
        } else {
          presetsSlot.innerHTML = '';
        }
      }
    }

    render();
  }).catch(() => {});
}

// ── App Settings Renderer ───────────────────────────────────────────────────

/**
 * Render schema-driven settings forms for each active app.
 * @param {HTMLElement|null} slot
 */
export async function renderAppSettings(slot) {
  if (!slot) return;

  try {
    const { getActiveApps, getAppSettings, setAppSetting } = await import('../lib/app-manager.js');
    const apps = getActiveApps().filter(app => {
      const schema = app.getSettingsSchema();
      return schema && schema.length > 0;
    });

    if (!apps.length) {
      slot.innerHTML = `<div class="text-xs text-disabled" style="padding:var(--space-2);">No apps have configurable settings.</div>`;
      return;
    }

    const fragments = [];

    for (const app of apps) {
      const schema = app.getSettingsSchema();
      const settings = await getAppSettings(app.id);

      const fieldsHTML = schema.map(field => {
        const val = settings[field.key] ?? field.defaultValue ?? '';
        const fieldId = `app-setting-${app.id}-${field.key}`;
        const descHTML = field.description
          ? `<div style="font-size:10px;color:var(--color-text-disabled);margin-top:2px;">${esc(field.description)}</div>`
          : '';

        switch (field.type) {
          case 'toggle':
            return `
              <div class="input-group" style="flex-direction:row;align-items:center;gap:8px;">
                <input type="checkbox" id="${fieldId}" data-app-id="${app.id}" data-key="${field.key}" ${val ? 'checked' : ''} />
                <label for="${fieldId}" style="margin:0;font-size:var(--font-xs);">${esc(field.label)}</label>
                ${descHTML ? `<div style="flex-basis:100%;">${descHTML}</div>` : ''}
              </div>`;

          case 'select':
            const options = (field.options || []).map(o =>
              `<option value="${esc(String(o.value))}" ${String(val) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`
            ).join('');
            return `
              <div class="input-group">
                <label for="${fieldId}" class="text-xs">${esc(field.label)}</label>
                <select class="select" id="${fieldId}" data-app-id="${app.id}" data-key="${field.key}">${options}</select>
                ${descHTML}
              </div>`;

          case 'textarea':
            return `
              <div class="input-group">
                <label for="${fieldId}" class="text-xs">${esc(field.label)}</label>
                <textarea class="input" id="${fieldId}" data-app-id="${app.id}" data-key="${field.key}" rows="2" placeholder="${esc(field.label)}">${esc(String(val))}</textarea>
                ${descHTML}
              </div>`;

          case 'number':
            return `
              <div class="input-group">
                <label for="${fieldId}" class="text-xs">${esc(field.label)}</label>
                <input class="input" type="number" id="${fieldId}" data-app-id="${app.id}" data-key="${field.key}" value="${esc(String(val))}" />
                ${descHTML}
              </div>`;

          case 'password':
            return `
              <div class="input-group">
                <label for="${fieldId}" class="text-xs">${esc(field.label)}</label>
                <input class="input" type="password" id="${fieldId}" data-app-id="${app.id}" data-key="${field.key}" value="${esc(String(val))}" placeholder="${esc(field.label)}" autocomplete="off" />
                ${descHTML}
              </div>`;

          default:
            return `
              <div class="input-group">
                <label for="${fieldId}" class="text-xs">${esc(field.label)}</label>
                <input class="input" type="text" id="${fieldId}" data-app-id="${app.id}" data-key="${field.key}" value="${esc(String(val))}" placeholder="${esc(field.label)}" />
                ${descHTML}
              </div>`;
        }
      }).join('');

      fragments.push(`
        <details class="app-settings-group" style="border:1px solid rgba(255,255,255,0.06);border-radius:var(--radius-md);overflow:hidden;">
          <summary style="padding:var(--space-3);cursor:pointer;display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);background:rgba(255,255,255,0.02);user-select:none;">
            <span style="font-size:1rem;">${app.icon}</span>
            ${esc(app.name)}
            <span style="font-size:9px;color:var(--color-text-disabled);margin-left:auto;">${esc(app.version)}</span>
          </summary>
          <div style="padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-3);">
            ${fieldsHTML}
          </div>
        </details>`);
    }

    slot.innerHTML = fragments.join('');

    slot.querySelectorAll('[data-app-id]').forEach(input => {
      input.addEventListener('change', async (e) => {
        const appId = e.target.dataset.appId;
        const key = e.target.dataset.key;
        const value = e.target.type === 'checkbox' ? e.target.checked
          : e.target.type === 'number' ? Number(e.target.value)
          : e.target.value.trim();
        try {
          await setAppSetting(appId, key, value);
          toast.success('Saved', `${key} updated for ${appId}.`);
        } catch (err) {
          toast.error('Save failed', err.message);
        }
      });
    });
  } catch {
    slot.innerHTML = `<div class="text-xs text-disabled" style="padding:var(--space-2);">App settings unavailable.</div>`;
  }
}
