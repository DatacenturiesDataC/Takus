// Takus — Integrations App (App Platform Wrapper)
// Wraps Slack, GitHub, Linear, Jira, Notion integration management.

import { createAppStub } from '../../lib/app-interface.js';

export const IntegrationsApp = createAppStub({
  id: 'integrations',
  name: 'Integrations',
  version: '1.0.0',
  description: 'Connect Slack, GitHub, Linear, Jira, and Notion to route tasks and summaries.',
  icon: '🔗',
  category: 'built-in',
  requires: [],

  async activate(platform) {
    this._platform = platform;
  },

  async deactivate() {
    this._platform = null;
  },

  getSettingsSchema() { return []; },
  getDefaultSettings() { return {}; },

  getNavItem() {
    // Integrations are managed via the App Manager (each is a sub-card)
    return null;
  },

  async renderPanel(container) {
    const { renderConnectInline } = await import('../../components/connect-panel.js');
    renderConnectInline(container);
  },

  getNodeTypes() { return []; },
  getEdgeTypes() { return []; },

  getStepTypes() {
    return [
      { type: 'integration_post', handler: async (ctx) => ctx, autoApprove: true },
      { type: 'integration_create', handler: async (ctx) => ctx, autoApprove: true },
    ];
  },

  getAutoRunPresets() {
    return [
      {
        field: 'type', operator: 'equals', value: 'update',
        label: 'Auto-run: post updates to Slack',
        description: 'Automatically post status update summaries to the configured Slack channel',
      },
    ];
  },

  canProduceInboxItems: false,
});

export default IntegrationsApp;
