// Takus — Recorder App (App Platform Wrapper)
// Wraps the existing recording stack as a self-contained app.
// This is a thin adapter: it delegates to existing modules rather than
// reimplementing them, preserving the battle-tested recording logic.

import { createAppStub } from '../../lib/app-interface.js';

/** @type {import('../../lib/app-interface.js').TakusApp} */
export const RecorderApp = createAppStub({
  id: 'recorder',
  name: 'Recorder',
  version: '1.0.0',
  description: 'Capture meetings, screens, presentations, and updates with AI-powered processing.',
  icon: '🎬',
  category: 'core',
  requires: [],

  async activate(platform) {
    this._platform = platform;

    // Register the 'recording' node type with the graph
    try {
      const { registerNodeType } = await import('../../lib/graph/node-registry.js');
      registerNodeType({
        type: 'recording',
        label: 'Recording',
        icon: '🎬',
        appId: 'recorder',
        requiredProps: ['title', 'date'],
      });
    } catch {}
  },

  async deactivate() {
    this._platform = null;
  },

  getSettingsSchema() {
    return [
      {
        key: 'videoQuality', label: 'Video Quality', type: 'select', defaultValue: '720p',
        options: [
          { label: '480p', value: '480p' },
          { label: '720p (recommended)', value: '720p' },
          { label: '1080p', value: '1080p' },
        ],
        syncable: true,
      },
      {
        key: 'audioQuality', label: 'Audio Quality', type: 'select', defaultValue: 'medium',
        options: [
          { label: 'Low (smaller files)', value: 'low' },
          { label: 'Medium (balanced)', value: 'medium' },
          { label: 'High (best quality)', value: 'high' },
        ],
        syncable: true,
      },
      { key: 'watermarkText', label: 'Watermark Text', type: 'text', defaultValue: '', description: 'Optional text overlay on recordings' },
    ];
  },

  getDefaultSettings() {
    return { videoQuality: '720p', audioQuality: 'medium', watermarkText: '' };
  },

  getNavItem() {
    return {
      id: 'history',
      label: 'Library',
      icon: '🕐',
      order: 10,
    };
  },

  async renderPanel(container) {
    // Delegate to existing history panel renderer
    const { renderHistoryPanel } = await import('../../components/history-panel.js');
    const { getShortcuts } = await import('../../components/settings-panel.js');
    const shortcuts = await getShortcuts().catch(() => ({ record: 'r', pause: ' ', stop: 's' }));
    renderHistoryPanel(container, shortcuts);
  },

  getNodeTypes() {
    return ['recording'];
  },

  getEdgeTypes() {
    return ['HAS_TASK', 'MENTIONED_IN'];
  },

  getStepTypes() {
    return [
      {
        type: 'ai_transcribe',
        handler: async (ctx) => {
          const { processContent } = await import('../../lib/content-pipeline.js');
          // Step executor will call this — but actual flow is still via pipeline
          return ctx;
        },
        autoApprove: true,
      },
      {
        type: 'ai_summarize',
        handler: async (ctx) => ctx,
        autoApprove: true,
      },
      {
        type: 'ai_extract_tasks',
        handler: async (ctx) => ctx,
        autoApprove: true,
      },
      {
        type: 'ai_analytics',
        handler: async (ctx) => ctx,
        autoApprove: true,
      },
    ];
  },

  getQuickActions() {
    return [
      {
        id: 'record',
        label: 'Record',
        icon: 'record',   // Resolved to record-btn style in renderer
        primary: true,
        order: 1,
        handler: () => {
          // Domain event — AppShell listens for this specific event
          document.dispatchEvent(new CustomEvent('takus:start-recording'));
        },
      },
    ];
  },

  getAutoRunPresets() {
    return [
      {
        field: 'type', operator: 'equals', value: 'meeting',
        label: 'Auto-run: process meetings',
        description: 'Process all meeting entries immediately (transcribe + summarize)',
      },
      {
        field: 'type', operator: 'equals', value: 'update',
        label: 'Auto-run: process updates',
        description: 'Process status update entries immediately',
      },
      {
        field: 'title', operator: 'contains', value: 'standup',
        label: 'Auto-run: process standups',
        description: 'Process entries with "standup" in the title',
      },
      {
        field: 'source', operator: 'equals', value: 'auto-record',
        label: 'Auto-run: calendar recordings',
        description: 'Process entries triggered by the auto-capture engine',
      },
    ];
  },

  /**
   * Render the Recorder's config panel on the home screen.
   * Delegates to the session-config component for type picker + camera/mic.
   *
   * @param {HTMLElement} container - The slot to render into
   * @param {object} callbacks - { isCameraActive, onTypeChange, onToggleCamera }
   */
  async renderConfigPanel(container, callbacks = {}) {
    const { renderSessionConfig } = await import('../../components/session-config.js');
    await renderSessionConfig(container, callbacks);
  },

  canProduceInboxItems: true,
});

export default RecorderApp;
