// Takus — Ask App (App Platform Wrapper)
// Wraps semantic search, RAG, and the wiki system.

import { createAppStub } from '../../lib/app-interface.js';

export const AskApp = createAppStub({
  id: 'ask',
  name: 'Ask',
  version: '1.0.0',
  description: 'Semantic search across all your entries. Ask questions and get sourced answers.',
  icon: '🔍',
  category: 'core',
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
        key: 'maxSources', label: 'Max Source Recordings', type: 'number',
        defaultValue: 5, description: 'Maximum number of entries to include in RAG context',
      },
    ];
  },

  getDefaultSettings() {
    return { maxSources: 5 };
  },

  getNavItem() {
    // Ask doesn't have a tab — it's the elevated search bar above tabs
    return null;
  },

  async renderPanel(container) {
    const { renderAskPanel } = await import('../../components/ask-panel.js');
    renderAskPanel(container);
  },

  getNodeTypes() { return ['wiki_entry']; },
  getEdgeTypes() { return []; },

  getStepTypes() {
    return [
      { type: 'autonomy_embed', handler: async (ctx) => ctx, autoApprove: true },
    ];
  },

  canProduceInboxItems: false,
});

export default AskApp;
