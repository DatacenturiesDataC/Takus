
// Takus — Ask Panel (Chat Evolution)
// Persistent conversational interface powered by semantic search + RAG.
// Threads persist in IndexedDB; each message searches the knowledge base silently.
import { icons } from '../lib/icons.js';
import { esc, renderMarkdown, fmtTimestamp, shortDate } from '../lib/utils.js';
import { getSettings } from '../lib/settings-store.js';
import { getEntries, getAllEmbeddings, saveWikiEntry, getWikiEntries, deleteWikiEntry, getMediaBlob } from '../lib/storage.js';
import { semanticSearch } from '../lib/embeddings.js';
import { generateAnswer } from '../lib/ai-engine.js';
import { recordSignal } from '../lib/preference-engine.js';
import { toast } from './toast.js';
import { typeLabel, typeAccent } from '../lib/content-types.js';
import { showWatchModal } from './watch-modal.js';
import { OPEN_ENTRY } from '../lib/events.js';
import { generateId } from '../lib/id.js';
import { createThread, saveThread, getThreads, getLegacyWiki, deleteThread, generateSubject } from '../lib/chat-store.js';



/**
 * Render the Ask panel into `container`.
 * @param {HTMLElement} container
 */
export async function renderAskPanel(container) {
  const [allEmbeddings, threads, legacyWiki] = await Promise.all([
    getAllEmbeddings().catch(() => []),
    getThreads().catch(() => []),
    getLegacyWiki().catch(() => []),
  ]);

  const hasEmbeddings = allEmbeddings.some(e => e.chunks?.length > 0);
  const embeddedCount = allEmbeddings.filter(e => e.chunks?.length > 0).length;
  const isMobile = window.innerWidth <= 640;
  const placeholder = hasEmbeddings
    ? `Ask across ${embeddedCount} indexed ${embeddedCount === 1 ? 'entry' : 'entries'}…`
    : isMobile ? 'Process an entry to enable Ask' : 'Ask your entries… (process an entry with AI to enable)';

  // Active thread state
  let _activeThread = null;
  let _isProcessing = false;

  function renderThreadList() {
    const items = threads.slice(0, 8);
    if (!items.length && !legacyWiki.length) return '';
    return `
      <div class="ask-threads">
        <div class="ask-threads-header">
          ${icons.messageSquare(11)} <span>Conversations</span>
          <button id="ask-new-thread" class="btn btn-ghost btn-sm" style="font-size:10px;margin-left:auto;" title="New conversation">${icons.plus(10)} New</button>
        </div>
        <div class="ask-threads-list">
          ${items.map(t => `
            <div class="ask-thread-row ${_activeThread?.id === t.id ? 'active' : ''}" data-id="${esc(t.id)}">
              <button class="ask-thread-btn" data-id="${esc(t.id)}" title="${esc(t.subject || t.query || 'Untitled')}">
                <span class="ask-thread-subject">${esc(t.subject || t.query?.slice(0, 40) || 'Untitled')}</span>
                <span class="ask-thread-meta">${t.messages?.length || 0} msgs · ${shortDate(t.date)}</span>
              </button>
              <button class="ask-thread-delete btn btn-ghost btn-icon btn-sm" data-id="${esc(t.id)}" title="Delete">${icons.x(10)}</button>
            </div>
          `).join('')}
        </div>
        ${legacyWiki.length ? `
          <div style="margin-top:var(--space-2);">
            <div class="ask-wiki-header" style="font-size:10px;">
              ${icons.zap(10)} <span>Saved answers</span>
              <span class="tasks-count">${legacyWiki.length}</span>
            </div>
            <div class="ask-wiki-list">
              ${legacyWiki.slice(0, 4).map(entry => `
                <div class="ask-wiki-entry" data-id="${esc(entry.id)}">
                  <button class="ask-wiki-query" data-query="${esc(entry.query)}" title="${esc(entry.query)}">${esc(entry.query)}</button>
                  <button class="ask-wiki-delete btn btn-ghost btn-icon btn-sm" data-id="${esc(entry.id)}" title="Remove">${icons.x(10)}</button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>`;
  }

  function renderMessages(thread) {
    if (!thread?.messages?.length) return '';
    return thread.messages.map(msg => {
      if (msg.role === 'user') {
        return `
          <div class="chat-msg chat-msg-user">
            <div class="chat-msg-bubble chat-msg-bubble-user">${esc(msg.content)}</div>
            <span class="chat-msg-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>`;
      }
      if (msg.role === 'assistant') {
        return `
          <div class="chat-msg chat-msg-assistant">
            <div class="chat-msg-bubble chat-msg-bubble-assistant">${renderMarkdown(msg.content)}</div>
            ${msg.sources?.length ? `
              <div class="chat-msg-sources">
                ${msg.sources.map(s => `
                  <span class="ask-source-chip" data-chip-rec-id="${esc(s.contentId)}" style="cursor:pointer;" title="${esc(s.title)}">
                    <span style="color:${typeAccent(s.type || 'screen')};font-size:9px;">●</span>
                    ${esc(s.title?.slice(0, 30) || 'Untitled')}
                  </span>
                `).join('')}
              </div>
            ` : ''}
            <span class="chat-msg-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>`;
      }
      return '';
    }).join('');
  }

  function renderChatView() {
    return `
      <div class="chat-view">
        <div class="chat-header">
          <button id="chat-back" class="btn btn-ghost btn-icon btn-sm" title="Back to threads">${icons.arrowLeft(14)}</button>
          <span class="chat-header-title">${esc(_activeThread?.subject || 'Chat')}</span>
          <button id="chat-save-wiki" class="btn btn-ghost btn-sm" style="font-size:10px;margin-left:auto;" title="Save last answer to Wiki">${icons.checkSquare(11)} Save</button>
        </div>
        <div class="chat-messages" id="chat-messages">
          ${renderMessages(_activeThread)}
          ${_isProcessing ? `
            <div class="chat-msg chat-msg-assistant">
              <div class="chat-msg-bubble chat-msg-bubble-assistant">
                <div class="ask-loading-dots"><span></span><span></span><span></span></div>
              </div>
            </div>
          ` : ''}
        </div>
        <div class="chat-input-bar">
          <input type="text" id="chat-input" class="chat-input" placeholder="Type a message…" autocomplete="off" ${_isProcessing ? 'disabled' : ''} />
          <button id="chat-send" class="btn btn-primary btn-sm" ${_isProcessing ? 'disabled' : ''}>${icons.send(14)}</button>
        </div>
      </div>`;
  }

  function paint() {
    container.innerHTML = `
      <div class="card card-compact animate-in ask-panel">
        ${_activeThread ? renderChatView() : `
          <div class="ask-bar">
            <span class="ask-icon">${icons.messageSquare(16)}</span>
            <input type="text" id="ask-input" class="ask-input"
              placeholder="${esc(placeholder)}" autocomplete="off"
              ${!hasEmbeddings ? 'disabled' : ''} />
            <kbd class="ask-kbd" id="ask-shortcut-hint">⌘K</kbd>
            <button id="ask-submit" class="btn btn-primary btn-sm" ${!hasEmbeddings ? 'disabled' : ''}>Ask</button>
          </div>
          <div id="ask-result" class="hidden"></div>
          ${renderThreadList()}
        `}
      </div>`;
    bindHandlers();
  }

  async function sendMessage(text) {
    if (!text.trim() || _isProcessing) return;
    const settings = getSettings();
    const provider = settings.aiProvider || 'openai';
    const apiKey = provider === 'gemini' ? settings.geminiKey : settings.openaiKey;
    if (!apiKey) { toast.warning('No API key', 'Add an API key in Settings.'); return; }

    // Create or continue thread
    if (!_activeThread) {
      _activeThread = createThread(text);
      threads.unshift(_activeThread);
    } else {
      _activeThread.messages.push({ role: 'user', content: text, timestamp: Date.now() });
    }
    _isProcessing = true;
    paint();
    _scrollToBottom();

    try {
      const [entries, embeddingsData] = await Promise.all([getEntries(), getAllEmbeddings()]);
      const topChunks = await semanticSearch(text, embeddingsData, apiKey, provider, 5);

      // Build conversation context for better responses
      const historyContext = _activeThread.messages
        .filter(m => m.role !== 'system')
        .slice(-6)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
        .join('\n');

      const contextualQuery = `Previous conversation:\n${historyContext}\n\nLatest question: ${text}`;
      const answer = await generateAnswer(contextualQuery, topChunks, entries, apiKey, provider);

      const sources = topChunks.map(r => {
        const match = entries.find(e => e.id === r.contentId);
        return match ? { contentId: match.id, title: match.title || 'Untitled', type: match.type || 'screen' } : null;
      }).filter(Boolean);

      _activeThread.messages.push({ role: 'assistant', content: answer, timestamp: Date.now(), sources });
      await saveThread(_activeThread);

      // Auto-generate subject after 2nd exchange
      if (_activeThread.messages.length === 4 && _activeThread.subject === _activeThread.messages[0].content.slice(0, 60)) {
        generateSubject(_activeThread.messages, apiKey, provider).then(subject => {
          _activeThread.subject = subject;
          saveThread(_activeThread).catch(() => {});
          const titleEl = container.querySelector('.chat-header-title');
          if (titleEl) titleEl.textContent = subject;
        }).catch(() => {});
      }

      recordSignal('SEARCH_CLICKED', { queryLength: text.length, isGlobalSearch: true }).catch(() => {});
    } catch (e) {
      _activeThread.messages.push({ role: 'assistant', content: `Error: ${e.message}`, timestamp: Date.now() });
      await saveThread(_activeThread).catch(() => {});
    }
    _isProcessing = false;
    paint();
    _scrollToBottom();
  }

  function _scrollToBottom() {
    requestAnimationFrame(() => {
      const el = container.querySelector('#chat-messages');
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  // Legacy one-shot search (for the initial bar)
  async function doSearch() {
    const input = container.querySelector('#ask-input');
    const query = input?.value?.trim();
    if (!query) return;
    // Start a new thread with this query
    await sendMessage(query);
  }

  function bindHandlers() {
    // Thread list mode
    container.querySelector('#ask-submit')?.addEventListener('click', doSearch);
    container.querySelector('#ask-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    });
    container.querySelector('#ask-new-thread')?.addEventListener('click', () => {
      _activeThread = null;
      paint();
      container.querySelector('#ask-input')?.focus();
    });
    container.querySelectorAll('.ask-thread-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeThread = threads.find(t => t.id === btn.dataset.id) || null;
        paint();
        _scrollToBottom();
      });
    });
    container.querySelectorAll('.ask-thread-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteThread(btn.dataset.id).catch(() => {});
        const idx = threads.findIndex(t => t.id === btn.dataset.id);
        if (idx >= 0) threads.splice(idx, 1);
        if (_activeThread?.id === btn.dataset.id) _activeThread = null;
        paint();
      });
    });
    // Legacy wiki
    container.querySelectorAll('.ask-wiki-query').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = container.querySelector('#ask-input');
        if (input) { input.value = btn.dataset.query; doSearch(); }
      });
    });
    container.querySelectorAll('.ask-wiki-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        await deleteWikiEntry(btn.dataset.id).catch(() => {});
        renderAskPanel(container);
      });
    });

    // Chat mode
    container.querySelector('#chat-back')?.addEventListener('click', () => {
      _activeThread = null;
      paint();
    });
    const chatInput = container.querySelector('#chat-input');
    container.querySelector('#chat-send')?.addEventListener('click', () => {
      if (chatInput?.value?.trim()) sendMessage(chatInput.value.trim());
    });
    chatInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (chatInput.value.trim()) sendMessage(chatInput.value.trim()); }
    });
    container.querySelector('#chat-save-wiki')?.addEventListener('click', async () => {
      if (!_activeThread?.messages?.length) return;
      const lastA = [..._activeThread.messages].reverse().find(m => m.role === 'assistant');
      const lastQ = [..._activeThread.messages].reverse().find(m => m.role === 'user');
      if (!lastA || !lastQ) return;
      const entry = { id: generateId('wiki'), date: Date.now(), query: lastQ.content, answer: lastA.content, sources: lastA.sources || [] };
      await saveWikiEntry(entry).catch(() => {});
      toast.success('Saved to Wiki');
    });
    // Source chips → open entry
    container.querySelectorAll('.ask-source-chip[data-chip-rec-id]').forEach(chip => {
      chip.addEventListener('click', async () => {
        const entries = await getEntries().catch(() => []);
        const entry = entries.find(r => r.id === chip.dataset.chipRecId);
        if (entry) document.dispatchEvent(new CustomEvent(OPEN_ENTRY, { detail: { entry } }));
      });
    });

    // Auto-focus input
    requestAnimationFrame(() => {
      const el = container.querySelector('#chat-input') || container.querySelector('#ask-input');
      if (el && !el.disabled) el.focus();
    });
  }

  paint();
}

/**
 * Focus the Ask input. Called by the Cmd+K keyboard shortcut.
 */
export function focusAskInput() {
  const input = document.getElementById('chat-input') || document.getElementById('ask-input');
  if (input && !input.disabled) { input.focus(); input.select(); }
}

/** Find goals relevant to a search query (pure local). */
async function _getRelevantGoals(query) {
  try {
    const { getNodesByType } = await import('../lib/storage.js');
    const goals = await getNodesByType('goal');
    if (!goals.length) return [];
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    if (!words.length) return [];
    return goals
      .filter(g => { const s = g.properties?.state || 'aspiration'; return s !== 'achieved' && s !== 'abandoned'; })
      .map(g => {
        const text = `${(g.properties?.title || '').toLowerCase()} ${(g.properties?.description || '').toLowerCase()}`;
        const matchCount = words.filter(w => text.includes(w)).length;
        return { id: g.id, title: g.properties?.title || 'Untitled', state: g.properties?.state || 'aspiration', matchCount };
      })
      .filter(g => g.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount)
      .slice(0, 3);
  } catch { return []; }
}
