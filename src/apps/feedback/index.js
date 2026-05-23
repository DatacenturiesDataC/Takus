// Takus — Feedback App (App Platform)
// Human feedback + automatic system diagnostic reports.
// Opt-in only; reports are previewed before submission.
// System-generated feedback is created automatically when repeated errors
// or performance regressions are detected.
//
// Delegates to feedback-engine.js and feedback-modal.js for UI.
// Registers the 'feedback_report' node type with the graph.

import { createAppStub } from '../../lib/app-interface.js';

export const FeedbackApp = createAppStub({
  id: 'feedback',
  name: 'Feedback',
  version: '1.0.0',
  description: 'Submit bug reports, feature requests, and view system diagnostics. All reports are previewed before sending.',
  icon: '💬',
  category: 'built-in',
  requires: [],

  async activate(platform) {
    this._platform = platform;

    // Register feedback_report node type
    try {
      const { registerNodeType } = await import('../../lib/graph/node-registry.js');
      registerNodeType({
        type: 'feedback_report',
        label: 'Feedback Report',
        icon: '💬',
        appId: 'feedback',
        requiredProps: ['category'],
      });
    } catch { /* non-critical */ }
  },

  async deactivate() {
    this._platform = null;
  },

  getSettingsSchema() {
    return [
      {
        key: 'autoDetectRegressions',
        label: 'Auto-detect performance regressions',
        type: 'toggle',
        defaultValue: true,
        description: 'Creates a draft feedback report when repeated errors or slowdowns are detected.',
      },
    ];
  },

  getDefaultSettings() {
    return { autoDetectRegressions: true };
  },

  getNavItem() {
    return {
      id: 'feedback',
      label: 'Feedback',
      icon: 'messageSquare',
      section: 'system',
      order: 120,
    };
  },

  async renderPanel(container) {
    try {
      const { getFeedbackHistory, gatherDiagnostics, getRecentErrors } = await import('../../lib/feedback-engine.js');
      const { esc, timeAgo } = await import('../../lib/utils.js');

      const history = getFeedbackHistory();
      const recentErrors = getRecentErrors();
      const diagnostics = await gatherDiagnostics();

      container.innerHTML = `
        <div class="card card-compact animate-in">
          <div class="card-header"><h2>💬 Feedback</h2></div>

          <div style="display:flex;gap:var(--space-4);padding:var(--space-3);">
            <div class="center-stack" style="flex:1;">
              <span class="text-2xl">${history.length}</span>
              <span class="text-xs text-muted">Reports sent</span>
            </div>
            <div class="center-stack" style="flex:1;">
              <span class="text-2xl">${recentErrors.length}</span>
              <span class="text-xs text-muted">Recent errors</span>
            </div>
            <div class="center-stack" style="flex:1;">
              <span class="text-2xl">${diagnostics.storageUsedMB || '?'}</span>
              <span class="text-xs text-muted">MB used</span>
            </div>
          </div>

          ${history.length > 0 ? `
            <div style="border-top:1px solid var(--color-border);padding:var(--space-3);max-height:200px;overflow-y:auto;">
              <h3 class="text-xs fw-semi" style="margin-bottom:var(--space-2);">Recent Reports</h3>
              ${history.slice(0, 5).map(h => `
                <div style="display:flex;justify-content:space-between;padding:var(--space-1) 0;font-size:var(--font-xs);color:var(--color-text-secondary);">
                  <span>${esc(h.category || 'feedback')} — ${esc((h.description || '').slice(0, 40))}</span>
                  <span class="text-9-disabled">${timeAgo(new Date(h.date))}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>`;

    } catch { /* non-critical */
      container.innerHTML = `<div class="card card-compact"><div class="card-header"><h2>💬 Feedback</h2></div><p class="text-sm text-muted" style="padding:var(--space-3);">Could not load feedback data.</p></div>`;
    }
  },

  getNodeTypes() { return ['feedback_report']; },
  getEdgeTypes() { return []; },
  getStepTypes() { return []; },
});
