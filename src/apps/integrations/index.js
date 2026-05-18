// Takus — Integrations App (App Platform Wrapper)
// Manages outbound integrations (Slack, GitHub, Linear, Jira, Notion)
// and inbound adapters (Slack messages, Email, Web Clipper).

import { createAppStub } from '../../lib/app-interface.js';

export const IntegrationsApp = createAppStub({
  id: 'integrations',
  name: 'Integrations',
  version: '2.0.0',
  description: 'Connect external tools. Push tasks to Jira/Slack/GitHub. Pull knowledge from email, Slack, and the web.',
  icon: '🔗',
  category: 'built-in',
  requires: [],

  async activate(platform) {
    this._platform = platform;

    // Register inbound adapters with the adapter registry
    try {
      const { registerAdapter } = await import('../../lib/inbound-adapter.js');
      const { SlackInboundAdapter } = await import('../../lib/adapters/slack-inbound.js');
      const { EmailInboundAdapter } = await import('../../lib/adapters/email-inbound.js');
      const { WebClipperAdapter } = await import('../../lib/adapters/web-clipper.js');

      registerAdapter(new SlackInboundAdapter());
      registerAdapter(new EmailInboundAdapter());
      registerAdapter(new WebClipperAdapter());
    } catch (e) {
      console.warn('[Integrations] Failed to register inbound adapters:', e.message);
    }
  },

  async deactivate() {
    // Unregister inbound adapters and stop polling
    try {
      const { unregisterAdapter, stopPolling } = await import('../../lib/inbound-adapter.js');
      for (const id of ['slack', 'email', 'web-clipper']) {
        stopPolling(id);
        unregisterAdapter(id);
      }
    } catch {}
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
  getEdgeTypes() { return ['INGESTED_FROM']; },

  getStepTypes() {
    return [
      { type: 'integration_post', handler: async (ctx) => ctx, autoApprove: true },
      { type: 'integration_create', handler: async (ctx) => ctx, autoApprove: true },
      { type: 'adapter_poll', handler: async (ctx) => ctx, autoApprove: true },
    ];
  },

  getAutoRunPresets() {
    return [
      {
        field: 'type', operator: 'equals', value: 'update',
        label: 'Auto-run: post updates to Slack',
        description: 'Automatically post status update summaries to the configured Slack channel',
      },
      {
        field: 'source', operator: 'equals', value: 'slack',
        label: 'Auto-run: process Slack imports',
        description: 'Automatically process messages imported from Slack',
      },
      {
        field: 'source', operator: 'equals', value: 'email',
        label: 'Auto-run: process email imports',
        description: 'Automatically process emails imported from Gmail or Outlook',
      },
    ];
  },

  canProduceInboxItems: true,
});

export default IntegrationsApp;
