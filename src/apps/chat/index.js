// Takus — Chat App (App Platform)
// Communication as a native modality of the knowledge graph.
// Every node can sprout a conversation thread; threads are lightweight
// sequences of messages stored in IndexedDB via chat-store.js.
//
// This app wraps the existing chat thread model (Ask panel conversations)
// and exposes it as a first-class platform app with its own node type.
//
// PRD §6.16 — Conversations Everywhere

import { createAppStub } from '../../lib/app-interface.js';

export const ChatApp = createAppStub({
  id: 'chat',
  name: 'Chat',
  version: '1.0.0',
  description: 'Conversational threads anchored to any knowledge node. Chat with AI about your content.',
  icon: '💬',
  category: 'built-in',
  requires: ['ask'],

  async activate(platform) {
    this._platform = platform;
    this._threadCount = 0;

    try {
      const { getThreads } = await import('../../lib/chat-store.js');
      const threads = await getThreads();
      this._threadCount = threads.length;
    } catch { /* non-critical */ }
  },

  async deactivate() {
    this._platform = null;
  },

  getSettingsSchema() {
    return [
      {
        key: 'ambientProcessing',
        label: 'Ambient Processing',
        type: 'toggle',
        defaultValue: false,
        description: 'Watch new messages and suggest tasks or Ask queries. Always under your approval.',
      },
      {
        key: 'aiDrafts',
        label: 'AI Draft Replies',
        type: 'toggle',
        defaultValue: false,
        description: 'When enabled, AI may propose a reply draft. You must explicitly send it.',
      },
    ];
  },

  getDefaultSettings() {
    return { ambientProcessing: false, aiDrafts: false };
  },

  getNavItem() {
    return {
      id: 'chat',
      label: 'Chat',
      icon: '💬',
      order: 65,
    };
  },

  async renderPanel(container) {
    try {
      const { getThreads } = await import('../../lib/chat-store.js');
      const { esc, timeAgo } = await import('../../lib/utils.js');

      const threads = await getThreads();
      this._threadCount = threads.length;

      if (!threads.length) {
        container.innerHTML = `
          <div class="card card-compact animate-in">
            <div class="card-header"><h2>💬 Conversations</h2></div>
            <div class="empty-state" style="padding:var(--space-6) var(--space-4);">
              <span style="font-size:32px;">💬</span>
              <p>No conversations yet.</p>
              <p class="text-xs text-muted" style="margin-top:calc(-1 * var(--space-2));">
                Start a conversation from the Ask panel or any entry.
              </p>
            </div>
          </div>`;
        return;
      }

      container.innerHTML = `
        <div class="card card-compact animate-in">
          <div class="card-header">
            <h2>💬 Conversations</h2>
            <span class="text-xs text-muted">${threads.length} thread${threads.length !== 1 ? 's' : ''}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--space-1);max-height:300px;overflow-y:auto;">
            ${threads.slice(0, 10).map(t => `
              <div class="chat-thread-item" data-id="${t.id}" style="padding:var(--space-2) var(--space-3);cursor:pointer;border-radius:var(--radius-sm);">
                <div class="text-sm fw-semi" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(t.subject || t.query || 'Untitled')}</div>
                <div class="text-xs text-muted">${timeAgo(new Date(t.date))} · ${(t.messages || []).length} messages</div>
              </div>
            `).join('')}
          </div>
        </div>`;

    } catch { /* non-critical */
      container.innerHTML = `<div class="card card-compact"><div class="card-header"><h2>💬 Conversations</h2></div><p class="text-sm text-muted" style="padding:var(--space-3);">Could not load conversations.</p></div>`;
    }
  },

  // Note: 'conversation' is *owned and registered* by AskApp (appId: 'ask').
  // ChatApp declares it here to express usage, not ownership. See `requires: ['ask']`.
  getNodeTypes() { return ['conversation']; },
  getEdgeTypes() { return ['HAS_CONVERSATION']; },

  getStepTypes() {
    return [
      {
        type: 'chat_process_intent',
        handler: async (step, ctx) => {
          // Intent processing from ambient conversation monitoring
          return { processed: true, intent: step.config?.intent || 'unknown' };
        },
        autoApprove: false, // Always requires user confirmation
      },
    ];
  },

  canProduceInboxItems: false,
});
