// Takus — Calendar App (App Platform Wrapper)
// Wraps calendar polling and auto-recording. Currently dormant but
// now activatable via the App Manager.

import { createAppStub } from '../../lib/app-interface.js';

export const CalendarApp = createAppStub({
  id: 'calendar',
  name: 'Calendar',
  version: '1.0.0',
  description: 'Calendar integration with auto-recording triggers. Connects to Google and Microsoft calendars.',
  icon: '📅',
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
        key: 'autoRecord', label: 'Auto-Record Meetings', type: 'toggle',
        defaultValue: false, description: 'Automatically start recording when a calendar meeting begins',
      },
      {
        key: 'bufferMinutes', label: 'Start Buffer (minutes)', type: 'number',
        defaultValue: 1, description: 'Start entry this many minutes before a meeting begins',
      },
      {
        key: 'monitoredCalendars', label: 'Monitored Calendars', type: 'text',
        defaultValue: 'primary', description: 'Comma-separated calendar IDs to monitor',
      },
    ];
  },

  getDefaultSettings() {
    return { autoRecord: false, bufferMinutes: 1, monitoredCalendars: 'primary' };
  },

  getNavItem() {
    return { id: 'calendar', label: 'Calendar', icon: '📅', order: 35 };
  },

  async renderPanel(container) {
    try {
      const { renderAutoRecordPanel } = await import('../../components/auto-record-panel.js');
      renderAutoRecordPanel(container);
    } catch {
      container.innerHTML = '<p style="color:var(--color-text-muted);padding:var(--space-4);">Calendar features are being set up.</p>';
    }
  },

  getNodeTypes() { return ['event']; },
  getEdgeTypes() { return []; },

  getStepTypes() {
    return [
      { type: 'auto_record', handler: async (ctx) => ctx, autoApprove: false },
    ];
  },

  getAutoRunPresets() {
    return [
      {
        field: 'source', operator: 'equals', value: 'auto-record',
        label: 'Auto-run: calendar entries',
        description: 'Process entries triggered by calendar auto-record',
      },
      {
        field: 'title', operator: 'contains', value: '1:1',
        label: 'Auto-run: 1:1 meetings',
        description: 'Process any entry with "1:1" in the title',
      },
    ];
  },

  canProduceInboxItems: true,
});

export default CalendarApp;
