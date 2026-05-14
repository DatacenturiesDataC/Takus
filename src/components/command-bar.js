// Takus — Command Bar (Knowledge OS: Universal Interface)
// Spotlight-style overlay activated via ⌘K / Ctrl+K.
// Provides unified search, navigation, and command execution.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { OPEN_RECORDING } from '../lib/events.js';

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
  keywords: ['history', 'recordings', 'browse'],
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
  label: 'Start Meeting Recording',
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
  label: 'Start Screen Recording',
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
          placeholder="Search recordings, people, or type a command…"
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

  // Build result list: recordings search + commands
  _filteredItems = [];

  // 1. Search recordings if query is non-empty
  if (lowerQuery.length >= 2) {
    try {
      const { getRecordings } = await import('../lib/storage.js');
      const recordings = await getRecordings();
      const matches = recordings
        .filter(r => {
          const title = (r.title || '').toLowerCase();
          const summary = (r.aiSummary || '').toLowerCase();
          const type = (r.type || '').toLowerCase();
          return title.includes(lowerQuery) || summary.includes(lowerQuery) || type.includes(lowerQuery);
        })
        .slice(0, 5)
        .map(r => ({
          id: `rec:${r.id}`,
          label: r.title || 'Untitled Recording',
          sublabel: new Date(r.date).toLocaleDateString() + (r.type ? ` · ${r.type}` : ''),
          icon: icons.video(14),
          category: 'Recordings',
          action: () => {
            document.dispatchEvent(new CustomEvent(OPEN_RECORDING, { detail: { recording: r } }));
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
