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

  /**
   * Inbound Poller contract — poll registered adapters for new items.
   * Bridges the existing adapter system to the core Inbound Poller.
   * @returns {Promise<import('../../lib/inbound-poller.js').InboundItem[]>}
   */
  async pollInbound() {
    try {
      const { getRegisteredAdapters } = await import('../../lib/inbound-adapter.js');
      const adapters = getRegisteredAdapters();
      const items = [];

      for (const adapter of adapters) {
        if (typeof adapter.poll !== 'function') continue;
        try {
          const adapterItems = await adapter.poll();
          if (Array.isArray(adapterItems)) {
            items.push(...adapterItems.map(item => ({
              sourceId: item.id || item.sourceId || `${adapter.id}-${Date.now()}`,
              sourceApp: 'integrations',
              title: item.title || item.subject || 'Untitled',
              type: item.type || adapter.id || 'note',
              textContent: item.text || item.body || item.content || '',
              date: item.timestamp || item.date || Date.now(),
              tags: [adapter.id, ...(item.tags || [])],
              metadata: item.metadata || {},
              autoProcess: item.autoProcess ?? false,
            })));
          }
        } catch (err) {
          console.warn(`[Integrations] Adapter ${adapter.id} poll failed:`, err.message);
        }
      }

      return items;
    } catch {
      return [];
    }
  },

  canProduceInboxItems: true,
});

export default IntegrationsApp;
