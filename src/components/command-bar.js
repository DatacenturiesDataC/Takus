// Takus — Command Bar (Knowledge OS: Universal Interface)
// Spotlight-style overlay activated via ⌘K / Ctrl+K.
// Provides unified search, navigation, and command execution.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { OPEN_ENTRY } from '../lib/events.js';

// ── Command Registry ─────────────────────────────────────────────────────────

/** @type {Array<{id: string, label: string, icon: string, category: string, action: function, keywords?: string[]}>} */
const _commands = [];

/**
 * Register a command in the command bar.
 * @param {object} cmd
 */
export function registerCommand(cmd) {
  if (!_commands.find(c => c.id === cmd.id)) _commands.push(cmd);
}

// ── Built-in Commands ────────────────────────────────────────────────────────

registerCommand({
  id: 'nav:home',
  label: 'Go to Home',
  icon: icons.zap(14),
  category: 'Navigation',
  keywords: ['insights', 'dashboard', 'right now'],
  action: () => _clickTab('insights'),
});

registerCommand({
  id: 'nav:library',
  label: 'Go to Library',
  icon: icons.video(14),
  category: 'Navigation',
  keywords: ['history', 'entries', 'browse'],
  action: () => _clickTab('history'),
});

registerCommand({
  id: 'nav:tasks',
  label: 'Go to Tasks',
  icon: icons.checkSquare(14),
  category: 'Navigation',
  keywords: ['todo', 'action items', 'pending'],
  action: () => _clickTab('tasks'),
});

registerCommand({
  id: 'nav:people',
  label: 'Go to People',
  icon: icons.users(14),
  category: 'Navigation',
  keywords: ['contacts', 'team', 'colleagues'],
  action: () => _clickTab('people'),
});

registerCommand({
  id: 'nav:settings',
  label: 'Go to Settings',
  icon: icons.settings(14),
  category: 'Navigation',
  keywords: ['preferences', 'config', 'api key', 'connect'],
  action: () => _clickTab('settings'),
});

registerCommand({
  id: 'action:record_meeting',
  label: 'Start Meeting Capture',
  icon: icons.mic(14),
  category: 'Actions',
  keywords: ['record', 'start', 'capture'],
  action: () => {
    closeCommandBar();
    // Click the record button if present and in idle state
    const recordBtn = document.getElementById('start-btn') || document.getElementById('btn-record');
    if (recordBtn && !recordBtn.disabled) recordBtn.click();
  },
});

registerCommand({
  id: 'action:record_screen',
  label: 'Start Screen Capture',
  icon: icons.monitor(14),
  category: 'Actions',
  keywords: ['record', 'screen', 'capture', 'demo'],
  action: () => {
    closeCommandBar();
    const recordBtn = document.getElementById('start-btn') || document.getElementById('btn-record');
    if (recordBtn && !recordBtn.disabled) recordBtn.click();
  },
});

registerCommand({
  id: 'action:ask',
  label: 'Ask Your Knowledge',
  icon: icons.search(14),
  category: 'Actions',
  keywords: ['search', 'query', 'question', 'find', 'rag'],
  action: () => {
    closeCommandBar();
    _clickTab('history');
    setTimeout(() => {
      const askInput = document.getElementById('ask-input');
      if (askInput) askInput.focus();
    }, 100);
  },
});

registerCommand({
  id: 'action:shortcuts',
  label: 'Keyboard Shortcuts',
  icon: '⌨️',
  category: 'Help',
  keywords: ['hotkeys', 'keys', 'bindings'],
  action: async () => {
    closeCommandBar();
    const { openShortcutsOverlay } = await import('../lib/keyboard-manager.js');
    const { getShortcuts } = await import('../lib/settings-store.js');
    const shortcuts = await getShortcuts().catch(() => ({ record: 'r', pause: ' ', stop: 's' }));
    openShortcutsOverlay(shortcuts);
  },
});

registerCommand({
  id: 'action:feedback',
  label: 'Send Feedback',
  icon: icons.edit(14),
  category: 'Help',
  keywords: ['bug', 'report', 'issue', 'feature request'],
  action: async () => {
    closeCommandBar();
    const { initFeedbackButton } = await import('./feedback-modal.js');
    // Trigger feedback modal via the existing button
    const btn = document.getElementById('feedback-fab');
    if (btn) btn.click();
  },
});

registerCommand({
  id: 'action:export_json',
  label: 'Export Data (JSON)',
  icon: icons.download(14),
  category: 'Data',
  keywords: ['export', 'backup', 'download', 'json', 'data'],
  action: async () => {
    closeCommandBar();
    const { toast } = await import('./toast.js');
    try {
      const { downloadExportJSON } = await import('../lib/export-engine.js');
      const summary = await downloadExportJSON();
      toast.success('Export complete', `${summary.entries} entries exported.`);
    } catch (e) {
      toast.error('Export failed', e.message);
    }
  },
});

registerCommand({
  id: 'action:export_markdown',
  label: 'Export Data (Markdown)',
  icon: icons.edit(14),
  category: 'Data',
  keywords: ['export', 'markdown', 'readable', 'report'],
  action: async () => {
    closeCommandBar();
    const { toast } = await import('./toast.js');
    try {
      const { downloadExportMarkdown } = await import('../lib/export-engine.js');
      await downloadExportMarkdown();
      toast.success('Export complete', 'Markdown file downloaded.');
    } catch (e) {
      toast.error('Export failed', e.message);
    }
  },
});

registerCommand({
  id: 'action:new_note',
  label: 'New Note',
  icon: icons.edit(14),
  category: 'Create',
  keywords: ['note', 'create', 'write', 'add', 'quick note', 'new'],
  action: () => {
    closeCommandBar();
    _openNewNoteModal();
  },
});

registerCommand({
  id: 'action:import_file',
  label: 'Import File',
  icon: icons.upload(14),
  category: 'Create',
  keywords: ['import', 'upload', 'file', 'document', 'txt', 'md', 'pdf'],
  action: () => {
    closeCommandBar();
    _triggerFileImport();
  },
});

// ── Overlay ──────────────────────────────────────────────────────────────────

let _overlay = null;
let _selectedIndex = 0;
let _filteredItems = [];
let _debounceTimer = null;

/**
 * Open the command bar.
 */
export function openCommandBar() {
  if (_overlay) return;

  _selectedIndex = 0;
  _overlay = document.createElement('div');
  _overlay.id = 'command-bar-overlay';
  _overlay.setAttribute('role', 'dialog');
  _overlay.setAttribute('aria-modal', 'true');
  _overlay.setAttribute('aria-label', 'Command bar');
  _overlay.style.cssText = [
    'position:fixed;inset:0;z-index:var(--z-modal);',
    'display:flex;align-items:flex-start;justify-content:center;padding-top:min(20vh,140px);',
    'background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);',
    'animation:fade-in 0.15s ease-out;',
  ].join('');

  _overlay.innerHTML = `
    <div id="command-bar" style="
      width:min(540px,calc(100vw - 32px));
      background:var(--color-bg-card);
      border:1px solid rgba(255,255,255,0.1);
      border-radius:var(--radius-lg);
      box-shadow:0 24px 80px rgba(0,0,0,0.6),0 0 0 1px rgba(255,255,255,0.05);
      overflow:hidden;
      animation:scale-in 0.15s ease-out;
    ">
      <div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3) var(--space-4);border-bottom:1px solid rgba(255,255,255,0.06);">
        ${icons.search(16)}
        <input
          id="command-bar-input"
          type="text"
          placeholder="Search entries, people, or type a command…"
          autocomplete="off"
          spellcheck="false"
          style="
            flex:1;background:transparent;border:none;outline:none;
            color:var(--color-text-primary);font-size:var(--font-md);
            font-family:var(--font-stack);
          "
        />
        <kbd style="
          font-size:10px;color:var(--color-text-disabled);
          background:rgba(255,255,255,0.06);padding:2px 6px;
          border-radius:4px;border:1px solid rgba(255,255,255,0.08);
          font-family:var(--font-mono);
        ">ESC</kbd>
      </div>
      <div id="command-bar-results" style="max-height:360px;overflow-y:auto;padding:var(--space-2) 0;"></div>
      <div style="
        display:flex;align-items:center;gap:var(--space-3);
        padding:var(--space-2) var(--space-4);
        border-top:1px solid rgba(255,255,255,0.04);
        font-size:10px;color:var(--color-text-disabled);
      ">
        <span>↑↓ navigate</span>
        <span>↵ select</span>
        <span>esc close</span>
      </div>
    </div>
  `;

  document.body.appendChild(_overlay);

  const input = document.getElementById('command-bar-input');
  const results = document.getElementById('command-bar-results');

  // Focus input
  requestAnimationFrame(() => input?.focus());

  // Initial render — show commands
  _renderResults(results, '');

  // Search on input (debounced for IDB queries)
  input?.addEventListener('input', () => {
    _selectedIndex = 0;
    clearTimeout(_debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      // Immediate render for short queries (commands only, no IDB hit)
      _renderResults(results, q);
    } else {
      _debounceTimer = setTimeout(() => _renderResults(results, q), 120);
    }
  });

  // Keyboard navigation
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _selectedIndex = Math.min(_selectedIndex + 1, _filteredItems.length - 1);
      _highlightSelected(results);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _selectedIndex = Math.max(_selectedIndex - 1, 0);
      _highlightSelected(results);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = _filteredItems[_selectedIndex];
      if (item?.action) {
        closeCommandBar();
        item.action();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandBar();
    }
  });

  // Click outside to close
  _overlay.addEventListener('mousedown', (e) => {
    if (e.target === _overlay) closeCommandBar();
  });
}

/**
 * Close the command bar.
 */
export function closeCommandBar() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  clearTimeout(_debounceTimer);
}

/**
 * Check if the command bar is open.
 */
export function isCommandBarOpen() {
  return !!_overlay;
}

// ── Render ────────────────────────────────────────────────────────────────────

async function _renderResults(container, query) {
  if (!container) return;

  const lowerQuery = query.toLowerCase();

  // Build result list: entries search + commands
  _filteredItems = [];

  // 1. Search entries using the search engine (Phase 50)
  if (lowerQuery.length >= 2) {
    try {
      const { searchContent } = await import('../lib/search-engine.js');
      const searchResults = await searchContent(query, { limit: 6 });
      const matches = searchResults.map(r => ({
        id: `rec:${r.id}`,
        label: r.title || 'Untitled',
        sublabel: (() => {
          const date = new Date(r.date).toLocaleDateString();
          const fields = r.matchedFields.filter(f => f !== 'title').join(', ');
          const snippet = r.snippet ? ` — ${r.snippet.slice(0, 60)}${r.snippet.length > 60 ? '…' : ''}` : '';
          return `${date} · ${r.type}${fields ? ` · matched: ${fields}` : ''}${snippet}`;
        })(),
        icon: icons.video(14),
        category: 'Library',
        action: () => {
          import('../lib/storage.js').then(({ getEntry }) => {
            getEntry(r.id).then(entry => {
              if (entry) document.dispatchEvent(new CustomEvent(OPEN_ENTRY, { detail: { entry } }));
            }).catch(() => {});
          }).catch(() => {});
        },
      }));
      _filteredItems.push(...matches);
    } catch {}

    // 2. Search contacts
    try {
      const { getContacts } = await import('../lib/storage.js');
      const contacts = await getContacts();
      const contactMatches = contacts
        .filter(c => {
          const name = (c.name || '').toLowerCase();
          const email = (c.email || '').toLowerCase();
          return name.includes(lowerQuery) || email.includes(lowerQuery);
        })
        .slice(0, 3)
        .map(c => ({
          id: `contact:${c.id}`,
          label: c.name || c.email || 'Unknown',
          sublabel: c.email || '',
          icon: icons.users(14),
          category: 'People',
          action: () => {
            _clickTab('people');
          },
        }));
      _filteredItems.push(...contactMatches);
    } catch {}
  }

  // 3. Filter commands
  const commandMatches = _commands.filter(cmd => {
    if (!lowerQuery) return true; // Show all commands when no query
    const haystack = [cmd.label, ...(cmd.keywords || [])].join(' ').toLowerCase();
    return haystack.includes(lowerQuery);
  });
  _filteredItems.push(...commandMatches);

  // Render
  if (_filteredItems.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:var(--space-6) var(--space-4);color:var(--color-text-disabled);font-size:var(--font-sm);">
        No results for "${esc(query)}"
      </div>`;
    return;
  }

  // Group by category
  const grouped = {};
  for (const item of _filteredItems) {
    const cat = item.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }

  let html = '';
  let globalIndex = 0;
  for (const [category, items] of Object.entries(grouped)) {
    html += `<div style="padding:var(--space-1) var(--space-4);font-size:10px;color:var(--color-text-disabled);font-weight:var(--weight-semi);text-transform:uppercase;letter-spacing:0.05em;">${esc(category)}</div>`;
    for (const item of items) {
      const isSelected = globalIndex === _selectedIndex;
      html += `
        <div
          class="cmd-item"
          data-index="${globalIndex}"
          style="
            display:flex;align-items:center;gap:var(--space-3);
            padding:var(--space-2) var(--space-4);
            cursor:pointer;transition:background 0.1s;
            background:${isSelected ? 'rgba(124,58,237,0.15)' : 'transparent'};
            ${isSelected ? 'border-left:2px solid var(--color-primary);padding-left:calc(var(--space-4) - 2px);' : ''}
          "
        >
          <span style="flex-shrink:0;color:${isSelected ? 'var(--color-primary-light)' : 'var(--color-text-muted)'};">${item.icon || ''}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:var(--font-sm);color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item.label)}</div>
            ${item.sublabel ? `<div style="font-size:10px;color:var(--color-text-disabled);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item.sublabel)}</div>` : ''}
          </div>
        </div>`;
      globalIndex++;
    }
  }

  container.innerHTML = html;

  // Click handlers
  container.querySelectorAll('.cmd-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index, 10);
      const item = _filteredItems[idx];
      if (item?.action) {
        closeCommandBar();
        item.action();
      }
    });
    el.addEventListener('mouseenter', () => {
      _selectedIndex = parseInt(el.dataset.index, 10);
      _highlightSelected(container);
    });
  });
}

function _highlightSelected(container) {
  container.querySelectorAll('.cmd-item').forEach(el => {
    const idx = parseInt(el.dataset.index, 10);
    const isSelected = idx === _selectedIndex;
    el.style.background = isSelected ? 'rgba(124,58,237,0.15)' : 'transparent';
    el.style.borderLeft = isSelected ? '2px solid var(--color-primary)' : 'none';
    el.style.paddingLeft = isSelected ? 'calc(var(--space-4) - 2px)' : 'var(--space-4)';
    const iconSpan = el.querySelector('span');
    if (iconSpan) iconSpan.style.color = isSelected ? 'var(--color-primary-light)' : 'var(--color-text-muted)';
  });

  // Scroll selected into view
  const selected = container.querySelector(`[data-index="${_selectedIndex}"]`);
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _clickTab(tabId) {
  closeCommandBar();
  const tab = document.querySelector(`.main-tab[data-tab="${tabId}"]`);
  if (tab) tab.click();
}

/**
 * Open a modal to create a new text note inline.
 * Saves via the document adapter and navigates to the library.
 */
async function _openNewNoteModal() {
  const modal = document.createElement('div');
  modal.id = 'new-note-modal';
  modal.style.cssText = [
    'position:fixed;inset:0;z-index:var(--z-modal);',
    'display:flex;align-items:center;justify-content:center;',
    'background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);',
    'animation:fade-in 0.15s ease-out;',
  ].join('');

  modal.innerHTML = `
    <div style="
      width:min(580px,calc(100vw - 32px));
      background:var(--color-bg-card);
      border:1px solid rgba(255,255,255,0.1);
      border-radius:var(--radius-lg);
      box-shadow:0 24px 80px rgba(0,0,0,0.6);
      overflow:hidden;animation:scale-in 0.15s ease-out;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-3) var(--space-4);border-bottom:1px solid rgba(255,255,255,0.06);">
        <span style="font-size:var(--font-md);font-weight:var(--weight-semi);color:var(--color-text-primary);">New Note</span>
        <button id="note-close" style="background:transparent;border:none;color:var(--color-text-muted);cursor:pointer;font-size:18px;padding:4px;" aria-label="Close">✕</button>
      </div>
      <div style="padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-3);">
        <input id="note-title" type="text" placeholder="Title" autofocus
          style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:var(--radius-sm);padding:var(--space-2) var(--space-3);font-size:var(--font-md);color:var(--color-text-primary);font-family:var(--font-stack);outline:none;" />
        <textarea id="note-content" rows="10" placeholder="Write your note here…\n\nSupports plain text. Markdown will be rendered in the Library."
          style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:var(--radius-sm);padding:var(--space-2) var(--space-3);font-size:var(--font-sm);color:var(--color-text-secondary);font-family:var(--font-mono);resize:vertical;line-height:1.6;outline:none;"></textarea>
        <div style="display:flex;gap:var(--space-2);justify-content:flex-end;">
          <button id="note-cancel" style="padding:var(--space-2) var(--space-4);border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,0.1);background:transparent;color:var(--color-text-muted);cursor:pointer;font-size:var(--font-sm);">Cancel</button>
          <button id="note-save" style="padding:var(--space-2) var(--space-4);border-radius:var(--radius-sm);border:none;background:var(--color-primary);color:#fff;cursor:pointer;font-weight:var(--weight-semi);font-size:var(--font-sm);">Save Note</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  requestAnimationFrame(() => document.getElementById('note-title')?.focus());

  const close = () => modal.remove();

  modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
  document.getElementById('note-close')?.addEventListener('click', close);
  document.getElementById('note-cancel')?.addEventListener('click', close);

  document.getElementById('note-save')?.addEventListener('click', async () => {
    const title = document.getElementById('note-title')?.value?.trim();
    const content = document.getElementById('note-content')?.value?.trim();

    if (!content) {
      const { toast } = await import('./toast.js');
      toast.error('Empty note', 'Please write some content first.');
      return;
    }

    const saveBtn = document.getElementById('note-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    try {
      const { ingestDocument, DocumentType } = await import('../lib/document-adapter.js');
      const result = await ingestDocument({
        title: title || 'Quick Note',
        content,
        type: DocumentType.NOTE,
        tags: ['note'],
      });

      if (result.success) {
        const { toast } = await import('./toast.js');
        toast.success('Note created', title || 'Quick Note');
        close();
        _clickTab('history');
      } else {
        throw new Error(result.error || 'Failed to save note');
      }
    } catch (e) {
      const { toast } = await import('./toast.js');
      toast.error('Save failed', e.message);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Note'; }
    }
  });

  // Ctrl/Cmd+Enter shortcut to save
  modal.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('note-save')?.click();
    }
    if (e.key === 'Escape') close();
  });
}

/**
 * Trigger native file picker for document import.
 * Accepts text files (.txt, .md, .json, .text, .markdown).
 */
function _triggerFileImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.md,.markdown,.json,.text,.html,.htm,.csv,.eml';
  input.multiple = true;
  input.style.display = 'none';

  input.addEventListener('change', async () => {
    const files = input.files;
    if (!files?.length) return;

    const { toast } = await import('./toast.js');
    const { extractTextFromFile, ingestDocument } = await import('../lib/document-adapter.js');

    let imported = 0;
    for (const file of files) {
      try {
        const doc = await extractTextFromFile(file);
        const result = await ingestDocument(doc);
        if (result.success) imported++;
      } catch (e) {
        toast.error('Import failed', `${file.name}: ${e.message}`);
      }
    }

    if (imported > 0) {
      toast.success(
        `${imported} file${imported > 1 ? 's' : ''} imported`,
        'Available in your Knowledge Library.'
      );
      _clickTab('history');
    }
    input.remove();
  });

  document.body.appendChild(input);
  input.click();
}
