// Takus — Drive App (App Platform Wrapper)
// Wraps cloud storage (Google Drive, OneDrive) as a platform service.

import { createAppStub } from '../../lib/app-interface.js';
import { FILE_SELECTED } from '../../lib/events.js';

export const DriveApp = createAppStub({
  id: 'drive',
  name: 'Drive',
  version: '1.0.0',
  description: 'Cloud storage sync with Google Drive and Microsoft OneDrive. Your data, your cloud.',
  icon: '☁️',
  category: 'built-in',
  requires: [],

  async activate(platform) {
    this._platform = platform;
  },

  async deactivate() {
    this._platform = null;
  },

  getSettingsSchema() {
    return [
      {
        key: 'provider', label: 'Cloud Provider', type: 'select', defaultValue: 'none',
        options: [
          { label: 'None', value: 'none' },
          { label: 'Google Drive', value: 'google' },
          { label: 'Microsoft OneDrive', value: 'microsoft' },
        ],
        description: 'Select your preferred cloud storage provider',
        syncable: false,
      },
    ];
  },

  getDefaultSettings() {
    return { provider: 'none' };
  },

  getNavItem() {
    // Drive is accessed via Settings, not a dedicated tab
    return null;
  },

  async renderPanel(container) {
    container.innerHTML = '<p style="color:var(--color-text-muted);padding:var(--space-4);">Drive settings are available in Settings.</p>';
  },

  getNodeTypes() { return []; },
  getEdgeTypes() { return []; },

  getStepTypes() {
    return [
      { type: 'cloud_sync', handler: async (ctx) => ctx, autoApprove: true },
      { type: 'cloud_upload', handler: async (ctx) => ctx, autoApprove: true },
    ];
  },

  getQuickActions() {
    return [
      {
        id: 'upload',
        label: 'Upload',
        icon: 'upload',
        primary: false,
        order: 10,  // After primary actions (Record is order 1)
        handler: () => this._pickAndValidateFile(),
      },
    ];
  },

  /**
   * Open a file picker, validate the selected file, and dispatch
   * a 'takus:file-selected' domain event for the platform to handle.
   * File selection + validation is a Drive concern.
   * State transitions are the platform's concern.
   */
  async _pickAndValidateFile() {
    const ACCEPT = 'video/webm,video/mp4,video/quicktime,audio/mp4,audio/wav,audio/mpeg,audio/webm,.webm,.mp4,.m4a,.wav,.mp3,.mov';
    const VALID_EXTS = ['webm', 'mp4', 'm4a', 'wav', 'mp3', 'mov'];
    const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.style.display = 'none';
    document.body.appendChild(input);

    const file = await new Promise((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] || null));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
    input.remove();

    if (!file) return;

    // Validate size
    if (file.size > MAX_SIZE) {
      const { toast } = await import('../../components/toast.js');
      toast.error('File too large', 'Maximum upload size is 2 GB.');
      return;
    }

    // Validate type
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!VALID_EXTS.includes(ext)) {
      const { toast } = await import('../../components/toast.js');
      toast.error('Unsupported format', `Accepted formats: ${VALID_EXTS.join(', ')}`);
      return;
    }

    // File is valid — dispatch domain event for the platform to handle
    document.dispatchEvent(new CustomEvent(FILE_SELECTED, { detail: { file } }));
  },

  getAutoRunPresets() {
    return [
      {
        field: 'source', operator: 'equals', value: 'upload',
        label: 'Auto-run: uploaded files',
        description: 'Process uploaded entries immediately (skip inbox)',
      },
    ];
  },

  canProduceInboxItems: false,
});

export default DriveApp;
