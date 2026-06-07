// Takus — Archive App (App Platform)
// Smart storage management. Scans for entries eligible for condensation,
// manages the condensed→archived lifecycle, and provides restore capability.
//
// Delegates to the battle-tested archive-engine.js for all heavy lifting.
// This app provides the UI, settings, and platform integration.

import { createAppStub } from '../../lib/app-interface.js';
import { esc, timeAgo } from '../../lib/utils.js';

export const ArchiveApp = createAppStub({
  id: 'archive',
  name: 'Archive',
  version: '1.0.0',
  description: 'Smart storage management. Condense old entries to save space while preserving key content.',
  icon: '🗄️',
  category: 'built-in',
  requires: ['recorder'],

  async activate(platform) {
    this._platform = platform;
  },

  async deactivate() {
    this._platform = null;
  },

  getSettingsSchema() {
    return [
      {
        key: 'archiveAfterDays',
        label: 'Auto-archive after (days)',
        type: 'number',
        defaultValue: 30,
        description: 'Entries older than this become eligible for condensation. Pinned and legally-held entries are always exempt.',
      },
      {
        key: 'graceWindowDays',
        label: 'Cold storage grace period (days)',
        type: 'number',
        defaultValue: 90,
        description: 'Condensed entries can be fully restored within this window.',
      },
      {
        key: 'autoCondense',
        label: 'Auto-condense eligible entries',
        type: 'toggle',
        defaultValue: false,
        description: 'When enabled, the autonomy engine will automatically condense eligible entries during idle time.',
      },
    ];
  },

  getDefaultSettings() {
    return { archiveAfterDays: 30, graceWindowDays: 90, autoCondense: false };
  },

  getNavItem() {
    return { id: 'archive', label: 'Archive', icon: 'package', order: 75 };
  },

  async renderPanel(container) {
    try {
      const [
        { scanEligibleEntries, getArchiveStats },
        { icons },
      ] = await Promise.all([
        import('../../lib/archive-engine.js'),
        import('../../lib/icons.js'),
      ]);

      const [eligible, stats] = await Promise.all([
        scanEligibleEntries(),
        getArchiveStats(),
      ]);

      container.innerHTML = `
        <div class="card card-compact animate-in">
          <div class="card-header"><h2>🗄️ Archive</h2></div>
          <div class="app-stat-grid">
            <div class="center-stack">
              <span class="text-2xl">${stats.condensed || 0}</span>
              <span class="text-xs text-muted">Condensed</span>
            </div>
            <div class="center-stack">
              <span class="text-2xl">${stats.archived || 0}</span>
              <span class="text-xs text-muted">Archived</span>
            </div>
            <div class="center-stack">
              <span class="text-2xl">${eligible.length}</span>
              <span class="text-xs text-muted">Eligible</span>
            </div>
          </div>
          ${eligible.length > 0 ? `
            <div class="app-section-sep">
              <p class="text-xs text-muted" style="margin-bottom:var(--space-2);">
                ${eligible.length} entr${eligible.length === 1 ? 'y' : 'ies'} eligible for condensation.
              </p>
              <button class="btn btn-sm archive-scan-btn">
                ${icons.zap(12)} Review Eligible
              </button>
            </div>
          ` : `
            <div class="empty-state archive-empty">
              <span class="archive-empty-icon">✨</span>
              <p class="text-xs text-muted">No entries eligible for archiving.</p>
            </div>
          `}
        </div>`;

    } catch { /* non-critical */
      container.innerHTML = `<div class="card card-compact"><div class="card-header"><h2>🗄️ Archive</h2></div><p class="text-sm text-muted app-section-sep">Could not load archive stats.</p></div>`;
    }
  },

  getNodeTypes() { return []; }, // Uses existing entry nodes with state=condensed|archived
  getEdgeTypes() { return []; },
  getStepTypes() {
    return [
      {
        type: 'system_condense',
        handler: async (step, ctx) => {
          const { archiveEntry } = await import('../../lib/archive-engine.js');
          return await archiveEntry(ctx.entry, ctx.videoBlob, ctx.onProgress);
        },
        autoApprove: false, // Always requires user confirmation
      },
    ];
  },
});
