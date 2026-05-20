// Takus — Documents App (App Platform)
// Manages document ingestion: PDF, DOCX, Markdown, and plain-text notes.
// All ingested items start as 'raw' and appear in the Inbox.
//
// Delegates to document-parsers.js for extraction logic.
// Registers the 'document' and 'note' node types with the graph.

import { createAppStub } from '../../lib/app-interface.js';

export const DocumentsApp = createAppStub({
  id: 'documents',
  name: 'Documents',
  version: '1.0.0',
  description: 'Import PDFs, Word files, Markdown, and notes. AI extracts key points, references, and action items.',
  icon: '📄',
  category: 'built-in',
  requires: [],
  canProduceInboxItems: true,

  async activate(platform) {
    this._platform = platform;

    // Register document and note node types
    try {
      const { registerNodeType } = await import('../../lib/graph/node-registry.js');
      registerNodeType({
        type: 'document',
        label: 'Document',
        icon: '📄',
        appId: 'documents',
        requiredProps: ['title'],
      });
      registerNodeType({
        type: 'note',
        label: 'Note',
        icon: '📝',
        appId: 'documents',
        requiredProps: ['title'],
      });
    } catch { /* non-critical */ }
  },

  async deactivate() {
    this._platform = null;
  },

  getSettingsSchema() {
    return [
      {
        key: 'autoProcessDocuments',
        label: 'Auto-process uploaded documents',
        type: 'toggle',
        defaultValue: false,
        description: 'When enabled, uploaded documents skip the Inbox and are processed immediately.',
      },
      {
        key: 'maxDocumentSizeMB',
        label: 'Max document size (MB)',
        type: 'number',
        defaultValue: 50,
        description: 'Documents larger than this will be rejected to protect storage quota.',
      },
    ];
  },

  getDefaultSettings() {
    return { autoProcessDocuments: false, maxDocumentSizeMB: 50 };
  },

  getNavItem() {
    return null; // Documents appear in history/inbox, not as a standalone tab
  },

  async renderPanel(container) {
    try {
      const { icons } = await import('../../lib/icons.js');
      const { getEntries } = await import('../../lib/storage.js');
      const { getCategory } = await import('../../lib/content-types.js');
      const entries = await getEntries();
      const docs = entries.filter(e => getCategory(e.type) === 'document');

      container.innerHTML = `
        <div class="card card-compact animate-in">
          <div class="card-header">
            <h2>📄 Documents</h2>
            <span class="text-xs text-muted">${docs.length} total</span>
          </div>
          <div class="empty-state" style="padding:var(--space-4);">
            <span style="font-size:24px;">📄</span>
            <p class="text-sm">Upload documents from the recorder panel or drag files into the app.</p>
            <p class="text-xs text-muted">Supports PDF, DOCX, Markdown, and plain text.</p>
          </div>
        </div>`;
    } catch { /* non-critical */
      container.innerHTML = `<div class="card card-compact"><div class="card-header"><h2>📄 Documents</h2></div><p class="text-sm text-muted" style="padding:var(--space-3);">Could not load documents.</p></div>`;
    }
  },

  getNodeTypes() { return ['document', 'note']; },
  getEdgeTypes() { return ['DERIVED_FROM']; },
  getStepTypes() { return []; },

  getQuickActions() {
    return [
      {
        id: 'upload-doc',
        label: 'Upload Document',
        icon: '📄',
        handler: () => {
          // Open file picker and ingest selected document
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.txt,.md,.pdf,.docx,.csv,.json';
          input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              const { ingestDocument } = await import('../../lib/document-adapter.js');
              await ingestDocument(file);
              // Refresh the library panel after import
              const slot = document.getElementById('history-slot');
              if (slot) {
                const { renderHistoryPanel } = await import('../../components/history-panel.js');
                await renderHistoryPanel(slot);
              }
            } catch (e) {
              console.warn('[Documents] Import failed:', e.message);
            }
          });
          input.click();
        },
      },
    ];
  },
});
