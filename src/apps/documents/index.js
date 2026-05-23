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
  canProduceInboxItems: false,

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
    return { id: 'documents', label: 'Documents', icon: 'edit', section: 'knowledge', order: 25 };
  },

  async renderPanel(container) {
    try {
      const { icons } = await import('../../lib/icons.js');
      const { getEntries } = await import('../../lib/storage.js');
      const { getCategory } = await import('../../lib/content-types.js');
      const { esc, timeAgo } = await import('../../lib/utils.js');
      const { formatSize } = await import('../../lib/recorder.js');
      const entries = await getEntries();
      const docs = entries.filter(e => getCategory(e.type) === 'document')
        .sort((a, b) => (b.date || 0) - (a.date || 0));

      const _typeIcon = (t) => {
        if (t === 'markdown') return '📗';
        if (t === 'email') return '📧';
        if (t === 'note') return '📝';
        if (t === 'bookmark') return '🔖';
        if (t === 'chat') return '💬';
        return '📄';
      };

      const docListHTML = docs.length > 0 ? docs.map(d => `
        <div class="goal-card" data-id="${d.id}" style="border-left:3px solid var(--color-info);cursor:pointer;" title="Click to view">
          <div style="display:flex;align-items:center;gap:var(--space-2);">
            <span style="font-size:18px;flex-shrink:0;">${_typeIcon(d.type)}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:var(--font-sm);font-weight:var(--weight-medium);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(d.title || 'Untitled')}</div>
              <div style="font-size:10px;color:var(--color-text-disabled);">
                ${d.type || 'text'} · ${d.date ? timeAgo(new Date(d.date)) : '—'}${d.size ? ` · ${formatSize(d.size)}` : ''}${d.state === 'raw' ? ' · <span style="color:var(--color-warning);">inbox</span>' : ''}
              </div>
            </div>
          </div>
        </div>
      `).join('') : `
        <div class="empty-state" style="padding:var(--space-6) var(--space-4);">
          <span style="font-size:28px;">📄</span>
          <p style="margin:var(--space-2) 0 0;">No documents yet</p>
          <p class="text-xs text-disabled" style="margin-top:2px;">Upload a file or paste text to import knowledge into Takus.</p>
        </div>`;

      container.innerHTML = `
        <div class="card card-compact animate-in">
          <div class="card-header">
            <h2>📄 Documents${docs.length > 0 ? ` <span style="font-size:11px;font-weight:600;padding:1px 7px;border-radius:8px;background:var(--color-info);color:#000;margin-left:6px;">${docs.length}</span>` : ''}</h2>
            <div class="flex-center gap-2">
              <label class="btn btn-sm" for="doc-panel-upload" style="font-size:var(--font-xs);background:var(--color-primary);color:#fff;border:none;border-radius:var(--radius-sm);font-weight:600;cursor:pointer;padding:4px 12px;display:inline-flex;align-items:center;gap:4px;">
                ${icons.upload(12)} Upload
              </label>
              <input type="file" id="doc-panel-upload" accept=".txt,.md,.pdf,.docx,.csv,.json" multiple style="display:none;" />
              <button class="btn btn-sm btn-ghost" id="doc-paste-text" style="font-size:var(--font-xs);padding:4px 10px;">
                ${icons.edit(12)} Paste Text
              </button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--space-1);${docs.length > 5 ? 'max-height:clamp(200px,40vh,400px);overflow-y:auto;' : ''}">
            ${docListHTML}
          </div>
        </div>`;

      // Bind upload
      const uploadInput = container.querySelector('#doc-panel-upload');
      uploadInput?.addEventListener('change', async () => {
        const files = Array.from(uploadInput.files || []);
        if (!files.length) return;
        try {
          const { ingestDocument } = await import('../../lib/document-adapter.js');
          const { toast } = await import('../../components/toast.js');
          let count = 0;
          for (const file of files) {
            await ingestDocument(file);
            count++;
          }
          toast.success('Imported', `${count} document${count > 1 ? 's' : ''} added to Library`);
          this.renderPanel(container); // Refresh list
        } catch (e) {
          const { toast } = await import('../../components/toast.js');
          toast.error('Import failed', e.message);
        }
      });

      // Bind paste-text
      container.querySelector('#doc-paste-text')?.addEventListener('click', async () => {
        try {
          const { promptAreaAsync } = await import('../../lib/dialog-utils.js');
          const text = await promptAreaAsync('Paste or type text to import as a document', 'Your text here…');
          if (!text?.trim()) return;
          const { ingestDocument } = await import('../../lib/document-adapter.js');
          // Create a synthetic text file from the pasted content
          const blob = new Blob([text], { type: 'text/plain' });
          const file = new File([blob], `Note — ${new Date().toLocaleDateString()}.txt`, { type: 'text/plain' });
          await ingestDocument(file);
          const { toast } = await import('../../components/toast.js');
          toast.success('Imported', 'Text note added to Library');
          this.renderPanel(container);
        } catch (e) {
          const { toast } = await import('../../components/toast.js');
          toast.error('Import failed', e.message);
        }
      });

      // Bind click-to-open on document cards
      container.querySelectorAll('.goal-card[data-id]').forEach(card => {
        card.addEventListener('click', async () => {
          const id = card.dataset.id;
          const entry = docs.find(d => d.id === id);
          if (entry) {
            const { OPEN_ENTRY } = await import('../../lib/events.js');
            document.dispatchEvent(new CustomEvent(OPEN_ENTRY, { detail: { entry } }));
          }
        });
      });

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
