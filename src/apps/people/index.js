// Takus — People App (App Platform Wrapper)
// Wraps contacts, closeness scoring, and knowledge levels as a self-contained app.

import { createAppStub } from '../../lib/app-interface.js';

export const PeopleApp = createAppStub({
  id: 'people',
  name: 'People',
  version: '1.0.0',
  description: 'Track relationships, closeness scores, and knowledge levels across your contacts.',
  icon: '👥',
  category: 'built-in',
  requires: ['recorder'],

  async activate(platform) {
    this._platform = platform;

    try {
      const { registerNodeType } = await import('../../lib/graph/node-registry.js');
      registerNodeType({
        type: 'person',
        label: 'Person',
        icon: '👤',
        appId: 'people',
        requiredProps: ['name'],
      });
    } catch {}
  },

  async deactivate() {
    this._platform = null;
  },

  getSettingsSchema() {
    return [
      {
        key: 'closenessThreshold', label: 'Close Contact Threshold', type: 'number',
        defaultValue: 65, description: 'Closeness score (0-100) above which a contact is marked as "close"',
      },
      {
        key: 'closenessWindow', label: 'Scoring Window (days)', type: 'number',
        defaultValue: 30, description: 'Number of days to look back for interaction scoring',
      },
    ];
  },

  getDefaultSettings() {
    return { closenessThreshold: 65, closenessWindow: 30 };
  },

  getNavItem() {
    return { id: 'people', label: 'People', icon: '👥', order: 30 };
  },

  async renderPanel(container) {
    const { renderContactsPanel } = await import('../../components/contacts-panel.js');
    renderContactsPanel(container);
  },

  getNodeTypes() { return ['person']; },
  getEdgeTypes() { return ['PARTICIPATED_IN']; },

  getStepTypes() {
    return [
      { type: 'autonomy_closeness', handler: async (ctx) => ctx, autoApprove: true },
      { type: 'autonomy_knowledge_levels', handler: async (ctx) => ctx, autoApprove: true },
    ];
  },

  canProduceInboxItems: false,
});

export default PeopleApp;
