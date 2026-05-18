// Takus — Calendar App (App Platform Wrapper)
// Wraps calendar polling and auto-recording.

import { createAppStub } from '../../lib/app-interface.js';

export const CalendarApp = createAppStub({
  id: 'calendar',
  name: 'Calendar',
  version: '1.0.0',
  description: 'Calendar integration with auto-recording triggers. Connects to Google and Microsoft calendars.',
  icon: '📅',
  category: 'built-in',
  requires: ['recorder'],

  _unsubscribe: null,

  async activate(platform) {
    this._platform = platform;

    // Wire calendar polling → auto-record evaluation → UI notification
    const settings = platform?.getSettings?.('calendar') || this.getDefaultSettings();
    if (settings.autoRecord) {
      try {
        const { startPolling, onEvents } = await import('../../lib/calendar-poller.js');
        const { evaluateAutoRecord, scheduleRecording, emitAutoRecordPending, getDefaultConfig } = await import('../../lib/auto-record-engine.js');

        const arConfig = {
          ...getDefaultConfig(),
          autoRecordEnabled: true,
          monitoredCalendars: new Set(
            (settings.monitoredCalendars || 'primary').split(',').map(s => s.trim())
          ),
          bufferBeforeMin: settings.bufferMinutes ?? 1,
          preNotify: true,
          userEmails: platform?.getUserEmails?.() || [],
        };

        // Subscribe to polled events and evaluate each for auto-recording
        this._unsubscribe = onEvents((events) => {
          for (const event of events) {
            const { decision } = evaluateAutoRecord(event, arConfig, {
              activeRecordingCount: 0,
              suppressionList: new Set(),
            });
            if (decision === 'RECORD') {
              // Schedule the recording with pre-notification
              scheduleRecording(event, arConfig, {
                onPreNotify: (ev) => emitAutoRecordPending(ev),
                onAutoStart: () => {},  // handled by app-shell via AUTO_RECORD_PENDING
                onAutoStop: () => {},   // future: auto-stop recording
              });
            }
          }
        });

        // Start polling — uses a provider-specific fetch function
        const fetchFn = await this._getCalendarFetchFn(platform);
        if (fetchFn) {
          const calendars = (settings.monitoredCalendars || 'primary')
            .split(',')
            .map(s => s.trim())
            .map(calId => ({
              calendarId: calId,
              provider: platform?.getCloudProvider?.() || 'google',
            }));

          startPolling(fetchFn, calendars, {
            intervalMs: 5 * 60 * 1000,
            hoursAhead: 2,
          });
        }
      } catch (e) {
        console.warn('[CalendarApp] Failed to activate auto-recording:', e.message);
      }
    }
  },

  async deactivate() {
    // Clean up polling and listeners
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    try {
      const { stopPolling, cancelAllSchedules } = await Promise.all([
        import('../../lib/calendar-poller.js'),
        import('../../lib/auto-record-engine.js'),
      ]).then(([cp, ar]) => ({ stopPolling: cp.stopPolling, cancelAllSchedules: ar.cancelAllSchedules }));
      stopPolling();
      cancelAllSchedules();
    } catch { /* noop */ }
    this._platform = null;
  },

  /**
   * Resolve the correct calendar fetch function based on the connected provider.
   * @private
   */
  async _getCalendarFetchFn(platform) {
    const provider = platform?.getCloudProvider?.();
    try {
      if (provider === 'microsoft') {
        const { fetchEvents } = await import('../../lib/microsoft-calendar.js');
        return fetchEvents;
      }
      // Default to Google
      const { fetchEvents } = await import('../../lib/google-calendar.js');
      return fetchEvents;
    } catch {
      return null;
    }
  },

  getSettingsSchema() {
    return [
      {
        key: 'autoRecord', label: 'Auto-Record Meetings', type: 'toggle',
        defaultValue: false, description: 'Automatically start recording when a calendar meeting begins',
      },
      {
        key: 'bufferMinutes', label: 'Start Buffer (minutes)', type: 'number',
        defaultValue: 1, description: 'Start recording this many minutes before a meeting begins',
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
