// Takus — Recording Type Picker
// Returns a Promise<string|null> — resolves with 'meeting'|'screen'|'presentation', null on cancel.
import { icons } from '../lib/icons.js';

const LAST_TYPE_KEY = 'takus_last_recording_type';

const TYPES = [
  {
    id: 'meeting',
    key: 'm',
    label: 'Meeting',
    icon: (s) => icons.calendar(s),
    description: 'Syncs with your calendar, extracts participants, and generates structured meeting notes with action items.',
    accent: '#7c3aed',
    accentDim: 'rgba(124,58,237,0.15)',
  },
  {
    id: 'screen',
    key: 's',
    label: 'Screen Recording',
    icon: (s) => icons.monitor(s),
    description: 'Capture demos, tutorials or walkthroughs. AI summarises what was shown and the key steps demonstrated.',
    accent: '#0ea5e9',
    accentDim: 'rgba(14,165,233,0.15)',
  },
  {
    id: 'presentation',
    key: 'p',
    label: 'Presentation',
    icon: (s) => icons.layout(s),
    description: 'Record your slide deck. AI extracts the key points, section structure and audience takeaways.',
    accent: '#10b981',
    accentDim: 'rgba(16,185,129,0.15)',
  },
  {
    id: 'update',
    key: 'u',
    label: 'Status Update',
    icon: (s) => icons.zap(s),
    description: 'Quick async update for your team. AI produces a TL;DR, ticket references and a shareable summary.',
    accent: '#f59e0b',
    accentDim: 'rgba(245,158,11,0.15)',
  },
];

export function showTypePicker() {
  return new Promise((resolve) => {
    document.getElementById('type-picker-overlay')?.remove();

    const lastType = localStorage.getItem(LAST_TYPE_KEY) || 'meeting';
    let focused = TYPES.findIndex(t => t.id === lastType);
    if (focused < 0) focused = 0;

    const overlay = document.createElement('div');
    overlay.id = 'type-picker-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Choose recording type');
    overlay.style.cssText = [
      'position:fixed;inset:0;',
      'background:rgba(0,0,0,0.7);',
      'display:flex;align-items:center;justify-content:center;',
      'z-index:var(--z-modal);',
      'padding:var(--space-4);',
      'backdrop-filter:blur(6px);',
    ].join('');

    overlay.innerHTML = `
      <div class="animate-in" style="width:100%;max-width:640px;display:flex;flex-direction:column;gap:var(--space-4);">
        <div style="text-align:center;">
          <h2 style="font-size:var(--font-lg);font-weight:var(--weight-bold);margin-bottom:var(--space-1);">What are you recording?</h2>
          <p style="font-size:var(--font-sm);color:var(--color-text-secondary);">Choose a type to tailor the AI summary and sharing options.</p>
        </div>
        <div id="type-picker-tiles" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--space-3);">
          ${TYPES.map((t, i) => `
            <button
              class="type-tile"
              data-id="${t.id}"
              data-idx="${i}"
              style="
                display:flex;flex-direction:column;align-items:flex-start;gap:var(--space-2);
                padding:var(--space-4);border-radius:var(--radius-lg);
                background:var(--color-bg-surface);
                border:2px solid ${i === focused ? t.accent : 'var(--color-border)'};
                cursor:pointer;text-align:left;width:100%;
                transition:border-color 0.15s ease,background 0.15s ease;
                outline:none;
              "
              aria-label="${t.label}"
            >
              <div style="
                width:44px;height:44px;border-radius:var(--radius-md);
                background:${i === focused ? t.accentDim : 'rgba(255,255,255,0.05)'};
                display:flex;align-items:center;justify-content:center;
                color:${i === focused ? t.accent : 'var(--color-text-secondary)'};
                transition:background 0.15s ease,color 0.15s ease;
              ">${t.icon(20)}</div>
              <div>
                <div style="font-weight:var(--weight-semi);font-size:var(--font-sm);color:var(--color-text-primary);margin-bottom:4px;">${t.label}</div>
                <div style="font-size:var(--font-xs);color:var(--color-text-muted);line-height:1.5;">${t.description}</div>
              </div>
              <div style="margin-top:auto;font-size:10px;color:var(--color-text-disabled);font-family:monospace;background:var(--color-bg-elevated);padding:2px 6px;border-radius:4px;border:1px solid var(--color-border);">
                press <strong>${t.key.toUpperCase()}</strong>
              </div>
            </button>
          `).join('')}
        </div>
        <p style="text-align:center;font-size:var(--font-xs);color:var(--color-text-disabled);">
          Press <kbd style="background:var(--color-bg-elevated);padding:2px 6px;border-radius:4px;border:1px solid var(--color-border);">Esc</kbd> to cancel
        </p>
      </div>`;

    document.body.appendChild(overlay);

    const tiles = [...overlay.querySelectorAll('.type-tile')];

    function applyFocus(idx) {
      focused = idx;
      tiles.forEach((tile, i) => {
        const t = TYPES[i];
        const isFocused = i === idx;
        tile.style.borderColor = isFocused ? t.accent : 'var(--color-border)';
        const icon = tile.querySelector('div');
        if (icon) {
          icon.style.background = isFocused ? t.accentDim : 'rgba(255,255,255,0.05)';
          icon.style.color = isFocused ? t.accent : 'var(--color-text-secondary)';
        }
      });
    }

    function pick(typeId) {
      localStorage.setItem(LAST_TYPE_KEY, typeId);
      cleanup();
      resolve(typeId);
    }

    function cancel() {
      cleanup();
      resolve(null);
    }

    function cleanup() {
      overlay.remove();
      document.removeEventListener('keydown', keyHandler);
    }

    tiles.forEach((tile, i) => {
      tile.addEventListener('mouseenter', () => applyFocus(i));
      tile.addEventListener('mouseleave', () => applyFocus(focused));
      tile.addEventListener('click', () => pick(TYPES[i].id));
      tile.addEventListener('focus', () => applyFocus(i));
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });

    function keyHandler(e) {
      if (e.key === 'Escape') { cancel(); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(TYPES[focused].id); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); applyFocus((focused + 1) % TYPES.length); tiles[focused].focus(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); applyFocus((focused - 1 + TYPES.length) % TYPES.length); tiles[focused].focus(); return; }
      const match = TYPES.findIndex(t => t.key === e.key.toLowerCase());
      if (match >= 0) { pick(TYPES[match].id); }
    }

    document.addEventListener('keydown', keyHandler);

    // Focus the last-used tile so keyboard users can immediately confirm with Enter
    setTimeout(() => tiles[focused]?.focus(), 50);
  });
}

/** Human-readable label for a recording type id */
export function typeLabel(typeId) {
  return TYPES.find(t => t.id === typeId)?.label || typeId || 'Recording';
}

/** Accent colour for badge display */
export function typeAccent(typeId) {
  return TYPES.find(t => t.id === typeId)?.accent || 'var(--color-text-muted)';
}
