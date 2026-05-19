// Takus — Inbox App (App Platform)
// Surfaces unprocessed items in the nav with a badge count.
// The inbox is the "waiting room" — items land here when no Auto-Run
// rule matches, and await manual processing by the user.

import { createAppStub } from '../../lib/app-interface.js';
import { esc, timeAgo } from '../../lib/utils.js';
import { getCategory } from '../../lib/content-types.js';

export const InboxApp = createAppStub({
  id: 'inbox',
  name: 'Inbox',
  version: '1.0.0',
  description: 'View and process incoming knowledge items awaiting AI analysis.',
  icon: '📥',
  category: 'core',
  requires: [],

  async activate(platform) {
    this._platform = platform;
    this._count = 0;

    try {
      const { getInboxCount } = await import('../../lib/inbox.js');
      this._count = await getInboxCount();
    } catch { /* non-critical */ }

    // Subscribe to Inbox Service events for live count updates
    try {
      const { onInboxEvent } = await import('../../lib/inbox.js');
      this._unsubInbox = onInboxEvent((event) => {
        if (event === 'inbox:received') this._count++;
        else if (event === 'inbox:completed' || event === 'inbox:auto-processed') {
          this._count = Math.max(0, this._count - 1);
        }
      });
    } catch { /* non-critical */ }
  },

  async deactivate() {
    if (this._unsubInbox) this._unsubInbox();
    this._platform = null;
  },

  getNavItem() {
    return {
      id: 'inbox',
      label: 'Inbox',
      icon: '📥',
      order: 5, // Before History (10) and Tasks (20)
      getBadgeCount: () => this._count || 0,
    };
  },

  async renderPanel(container) {
    // Render inbox items — filter history to raw items only
    try {
      const { getInboxItems } = await import('../../lib/inbox.js');
      const inboxItems = await getInboxItems();

      if (!inboxItems.length) {
        container.innerHTML = `
          <div class="card card-compact animate-in">
            <div class="card-header"><h2>📥 Inbox</h2></div>
            <div class="empty-state" style="padding:var(--space-6) var(--space-4);">
              <span style="font-size:32px;">✨</span>
              <p>All caught up!</p>
              <p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:calc(-1 * var(--space-2));">
                New entries will appear here when they need processing.
              </p>
            </div>
          </div>`;
        return;
      }

      const { formatDuration, formatSize } = await import('../../lib/recorder.js');
      const { icons } = await import('../../lib/icons.js');

      container.innerHTML = `
        <div class="card card-compact animate-in">
          <div class="card-header">
            <h2>📥 Inbox <span style="font-size:11px;font-weight:600;padding:1px 7px;border-radius:8px;background:var(--color-warning);color:#000;margin-left:6px;">${inboxItems.length}</span></h2>
            <button class="btn btn-sm inbox-process-all" style="font-size:var(--font-xs);background:var(--color-warning);color:#000;border:none;border-radius:var(--radius-sm);font-weight:600;cursor:pointer;padding:4px 12px;">
              ${icons.zap(12)} Process All
            </button>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--space-2);max-height:clamp(200px,35vh,400px);overflow-y:auto;">
            ${inboxItems.map(r => {
              const ago = timeAgo(new Date(r.date));
              return `
                <div class="inbox-item" data-id="${r.id}" style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) var(--space-3);border-left:3px solid var(--color-warning);background:rgba(245,158,11,0.04);border-radius:var(--radius-sm);cursor:pointer;">
                  <div style="min-width:0;flex:1;">
                    <div style="font-size:var(--font-sm);font-weight:var(--weight-medium);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.title || 'Untitled')}</div>
                    <div style="font-size:var(--font-xs);color:var(--color-text-muted);">${ago} · ${getCategory(r.type) === 'document' ? `${(r.textContent || '').split(/\s+/).length.toLocaleString()} words` : formatDuration(r.duration)} · ${formatSize(r.size)}</div>
                  </div>
                  <button class="btn btn-sm inbox-process-one" data-id="${r.id}" style="flex-shrink:0;font-size:11px;padding:2px 10px;background:var(--color-warning);color:#000;border-radius:var(--radius-sm);font-weight:600;border:none;cursor:pointer;">
                    ${icons.zap(12)} Process
                  </button>
                  <button class="btn btn-sm inbox-dismiss" data-id="${r.id}" title="Dismiss" style="flex-shrink:0;font-size:11px;padding:2px 8px;background:transparent;color:var(--color-text-muted);border:1px solid rgba(255,255,255,0.1);border-radius:var(--radius-sm);cursor:pointer;">
                    ✕
                  </button>
                </div>`;
            }).join('')}
          </div>
        </div>`;

      // Bind process buttons
      container.querySelectorAll('.inbox-process-one').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const entry = inboxItems.find(r => r.id === id);
          if (!entry) return;
          btn.disabled = true;
          btn.textContent = '⏳';
          try {
            const { processRawEntry } = await import('../../lib/content-pipeline.js');
            await processRawEntry(entry);
            this._count = Math.max(0, this._count - 1);
            this.renderPanel(container); // Re-render
          } catch (err) {
            const { toast } = await import('../../components/toast.js');
            toast.error('Processing failed', err.message);
            btn.disabled = false;
            btn.textContent = '⚡ Process';
          }
        });
      });

      container.querySelector('.inbox-process-all')?.addEventListener('click', async () => {
        const buttons = container.querySelectorAll('.inbox-process-one');
        for (const btn of buttons) btn.click();
      });

      // Click on item → open entry detail
      container.querySelectorAll('.inbox-item').forEach(item => {
        item.addEventListener('click', async (e) => {
          if (e.target.closest('.inbox-process-one')) return;
          const id = item.dataset.id;
          const entry = inboxItems.find(r => r.id === id);
          if (entry) {
            const { OPEN_ENTRY } = await import('../../lib/events.js');
            document.dispatchEvent(new CustomEvent(OPEN_ENTRY, { detail: { entry } }));
          }
        });
      });

      // Dismiss buttons
      container.querySelectorAll('.inbox-dismiss').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const { dismissInboxItem } = await import('../../lib/inbox.js');
            await dismissInboxItem(btn.dataset.id);
            this._count = Math.max(0, this._count - 1);
            this.renderPanel(container);
          } catch { /* non-critical */ }
        });
      });

    } catch (err) {
      container.innerHTML = `<div class="card card-compact"><div class="card-header"><h3>📥 Inbox</h3></div><p style="padding:var(--space-3);color:var(--color-text-muted);font-size:var(--font-sm);">Could not load inbox.</p></div>`;
    }
  },

  getQuickActions() { return []; },
  getNodeTypes() { return []; },
  getEdgeTypes() { return []; },
  getStepTypes() { return []; },
  canProduceInboxItems: false, // Inbox consumes, not produces
});

