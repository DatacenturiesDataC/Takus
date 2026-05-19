// Takus — Insights App (App Platform Wrapper)
// Wraps analytics, blind spot detection, meeting prep, and daily digest.

import { createAppStub } from '../../lib/app-interface.js';

export const InsightsApp = createAppStub({
  id: 'insights',
  name: 'Insights',
  version: '1.0.0',
  description: 'Analytics, blind spots, meeting prep, and intelligent summaries across your entries.',
  icon: '📊',
  category: 'built-in',
  requires: ['recorder'],

  async activate(platform) {
    this._platform = platform;

    // Register ai_insight node type with the graph
    try {
      const { registerNodeType } = await import('../../lib/graph/node-registry.js');
      registerNodeType({
        type: 'ai_insight',
        label: 'AI Insight',
        icon: '📊',
        appId: 'insights',
        requiredProps: [],
      });
    } catch { /* non-critical */ }
  },

  async deactivate() {
    this._platform = null;
  },

  getSettingsSchema() {
    return [
      {
        key: 'blindSpots', label: 'Blind Spot Detection', type: 'toggle',
        defaultValue: true, description: 'Surface patterns you may be overlooking',
      },
      {
        key: 'dissent', label: 'Dissent & Open Questions', type: 'toggle',
        defaultValue: true, description: 'Flag disagreements and assumptions in meeting summaries',
      },
    ];
  },

  getDefaultSettings() {
    return { blindSpots: true, dissent: true };
  },

  getNavItem() {
    return { id: 'insights', label: 'Insights', icon: '📊', order: 40 };
  },

  async renderPanel(container) {
    const { renderInsightsPanel } = await import('../../components/insights-panel.js');
    renderInsightsPanel(container);
  },

  getNodeTypes() { return ['ai_insight']; },
  getEdgeTypes() { return []; },

  getStepTypes() {
    return [
      { type: 'autonomy_archive_scan', handler: async (ctx) => ctx, autoApprove: true },
    ];
  },

  canProduceInboxItems: false,
});

export default InsightsApp;
