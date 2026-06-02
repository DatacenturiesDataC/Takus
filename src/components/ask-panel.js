
// Takus — Ask Panel (Chat Evolution)
// Persistent conversational interface powered by semantic search + RAG.
// Threads persist in IndexedDB; each message searches the knowledge base silently.
import { icons } from '../lib/icons.js';
import { confirmAsync } from '../lib/dialog-utils.js';
import { esc, renderMarkdown, fmtTimestamp, shortDate } from '../lib/utils.js';
import { getSettings, getEffectiveAIConfig } from '../lib/settings-store.js';
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
    if (!items.length && !legacyWiki.length) {
      return `
        <div class="ask-threads px-3">
          <div class="empty-state" style="border: 1px dashed rgba(124, 58, 237, 0.2); background: rgba(124, 58, 237, 0.01);">
            <div class="ask-empty-icon">
              ${icons.messageSquare(20)}
            </div>
            <p class="font-bold text-sm no-margin">Start a conversation</p>
            <p class="text-xs text-muted no-margin mb-2" style="max-width: 260px; line-height: 1.4;">
              Ask questions about your entries. Every message searches your knowledge base.
            </p>
            <div class="ask-empty-tips">
              <span class="ask-empty-tip-row">💡 <span class="text-muted">Try:</span> <em style="font-style:normal;color:var(--color-text-primary);">"What did I discuss last week?"</em></span>
              <span class="ask-empty-tip-row">⚡ <span class="text-muted">Quick:</span> <em style="font-style:normal;color:var(--color-text-primary);">"Create a task: Review Q3 metrics"</em></span>
              <span class="ask-empty-tip-row">📝 <span class="text-muted">Notes:</span> <em style="font-style:normal;color:var(--color-text-primary);">"Save a note: Design update"</em></span>
            </div>
          </div>
        </div>`;
    }
    return `
      <div class="ask-threads">
        <div class="ask-threads-header">
          ${icons.messageSquare(11)} <span>Conversations</span>
          <button id="ask-new-thread" class="btn btn-ghost btn-sm text-10 ml-auto"  title="New conversation">${icons.plus(10)} New</button>
        </div>
        ${items.length >= 3 ? `
          <div class="ask-thread-search">
            <input type="text" id="ask-thread-search-input" class="ask-thread-search-input"
              placeholder="Filter conversations…" autocomplete="off" aria-label="Search conversations" />
          </div>
        ` : ''}
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
          <div class="mt-2">
            <div class="ask-wiki-header text-10" >
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
                  <span class="ask-source-chip cursor-pointer" data-chip-rec-id="${esc(s.contentId)}"  title="${esc(s.title)}">
                    <span class="text-9-disabled" style="color:${typeAccent(s.type || 'screen')}">●</span>
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
          <button id="chat-save-wiki" class="btn btn-ghost btn-sm text-10 ml-auto"  title="Save last answer to Wiki">${icons.checkSquare(11)} Save</button>
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
          <div class="ask-qa-menu-wrap">
            <button id="chat-quick-actions" class="btn btn-ghost btn-icon btn-sm ask-qa-btn" title="Quick actions" aria-label="Quick actions">${icons.plus(16)}</button>
            <div id="chat-qa-menu" class="ask-qa-menu hidden">
              <button class="chat-qa-item menu-item-btn" data-action="task">${icons.checkSquare(12)} New Task</button>
              <button class="chat-qa-item menu-item-btn" data-action="note">${icons.edit(12)} New Note</button>
              <button class="chat-qa-item menu-item-btn" data-action="search">${icons.search(12)} Search entries</button>
            </div>
          </div>
          <input type="text" id="chat-input" class="chat-input" placeholder="Type a message…" autocomplete="off" ${_isProcessing ? 'disabled' : ''} />
          <button id="chat-send" class="btn btn-primary btn-sm" aria-label="Send message" ${_isProcessing ? 'disabled' : ''}>${icons.send(14)}</button>
        </div>
      </div>`;
  }

  function paint() {
    container.innerHTML = `
      <div class="card card-compact animate-in ask-panel">
        ${_activeThread ? renderChatView() : `
          ${hasEmbeddings ? `
            <div class="ask-bar">
              <span class="ask-icon">${icons.messageSquare(16)}</span>
              <input type="text" id="ask-input" class="ask-input"
                placeholder="${esc(placeholder)}" autocomplete="off" />
              <kbd class="ask-kbd" id="ask-shortcut-hint">⌘K</kbd>
              <button id="ask-submit" class="btn btn-primary btn-sm">Ask</button>
            </div>
          ` : `
            <div class="ask-bar flex-col items-center gap-2" style="padding:var(--space-5) var(--space-4);">
              <div class="ask-no-embeddings-icon">${icons.search(18)}</div>
              <p class="font-semi text-sm no-margin">Ask your knowledge</p>
              <p class="text-xs text-muted text-center no-margin" style="max-width:320px;line-height:1.5;">Record a meeting, import a document, or add content — AI will process it and enable semantic search across your knowledge base.</p>
            </div>
          `}
          <div id="ask-result" class="hidden"></div>
          ${renderThreadList()}
        `}
      </div>`;
    bindHandlers();
  }

  async function sendMessage(text) {
    if (!text.trim() || _isProcessing) return;
    const aiConfig = getEffectiveAIConfig();
    const provider = aiConfig.provider;
    const apiKey = aiConfig.apiKey;
    if (!apiKey && !aiConfig.useProxy) { toast.warning('No API key', 'Add an API key in Settings or join a workspace.'); return; }

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
      const topChunks = await semanticSearch(text, embeddingsData, apiKey, provider, 5, aiConfig);

      // Build conversation context for better responses
      const historyContext = _activeThread.messages
        .filter(m => m.role !== 'system')
        .slice(-6)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
        .join('\n');

      const contextualQuery = `Previous conversation:\n${historyContext}\n\nLatest question: ${text}`;
      const answer = await generateAnswer(contextualQuery, topChunks, entries, apiKey, provider, aiConfig);

      const sources = topChunks.map(r => {
        const match = entries.find(e => e.id === r.contentId);
        return match ? { contentId: match.id, title: match.title || 'Untitled', type: match.type || 'screen' } : null;
      }).filter(Boolean);

      _activeThread.messages.push({ role: 'assistant', content: answer, timestamp: Date.now(), sources });
      await saveThread(_activeThread);

      // ── Command extraction from chat ──
      const lowerText = text.toLowerCase().trim();
      if (lowerText.startsWith('create a task:') || lowerText.startsWith('add task:') || lowerText.startsWith('todo:')) {
        const taskTitle = text.replace(/^(create a task:|add task:|todo:)\s*/i, '').trim();
        if (taskTitle) {
          _createChatTask(taskTitle, _activeThread.id).catch(() => {});
        }
      } else if (lowerText.startsWith('save a note:') || lowerText.startsWith('note:')) {
        const noteContent = text.replace(/^(save a note:|note:)\s*/i, '').trim();
        if (noteContent) {
          _createChatNote(noteContent).catch(() => {});
        }
      } else {
        // Auto-extract tasks from AI response (look for action items)
        _extractTasksFromResponse(answer, _activeThread.id).catch(() => {});
      }

      // Auto-generate subject after 2nd exchange
      if (_activeThread.messages.length === 4 && _activeThread.subject === _activeThread.messages[0].content.slice(0, 60)) {
        generateSubject(_activeThread.messages, apiKey, provider, aiConfig).then(subject => {
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

    // Thread search filter
    const searchInput = container.querySelector('#ask-thread-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        container.querySelectorAll('.ask-thread-row').forEach(row => {
          const id = row.dataset.id;
          const thread = threads.find(t => t.id === id);
          if (!thread) { row.style.display = 'none'; return; }
          const subject = (thread.subject || thread.query || '').toLowerCase();
          const messages = (thread.messages || []).map(m => m.content).join(' ').toLowerCase();
          const match = !q || subject.includes(q) || messages.includes(q);
          row.style.display = match ? '' : 'none';
        });
      });
    }
    container.querySelectorAll('.ask-thread-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeThread = threads.find(t => t.id === btn.dataset.id) || null;
        paint();
        _scrollToBottom();
      });
      // Keyboard navigation
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = btn.closest('.ask-thread-row')?.nextElementSibling?.querySelector('.ask-thread-btn');
          next?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = btn.closest('.ask-thread-row')?.previousElementSibling?.querySelector('.ask-thread-btn');
          prev?.focus();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const delBtn = btn.closest('.ask-thread-row')?.querySelector('.ask-thread-delete');
          delBtn?.click();
        }
      });
    });
    container.querySelectorAll('.ask-thread-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const threadToDelete = threads.find(t => t.id === btn.dataset.id);
        const label = threadToDelete?.subject || threadToDelete?.query?.slice(0, 30) || 'this conversation';
        if (!await confirmAsync(`Delete "${label}"?`, { destructive: true })) return;
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

    // Quick Actions "+" menu
    const qaBtn = container.querySelector('#chat-quick-actions');
    const qaMenu = container.querySelector('#chat-qa-menu');
    qaBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      qaMenu?.classList.toggle('hidden');
    });
    // Close menu on outside click
    if (qaMenu) {
      const closeQA = () => qaMenu.classList.add('hidden');
      document.addEventListener('click', closeQA, { once: true });
    }
    container.querySelectorAll('.chat-qa-item').forEach(item => {
      item.addEventListener('click', async () => {
        qaMenu?.classList.add('hidden');
        const action = item.dataset.action;
        const chatInput = container.querySelector('#chat-input');
        if (action === 'task') {
          if (chatInput) { chatInput.value = 'Create a task: '; chatInput.focus(); }
        } else if (action === 'note') {
          if (chatInput) { chatInput.value = 'Save a note: '; chatInput.focus(); }
        } else if (action === 'search') {
          if (chatInput) { chatInput.value = ''; chatInput.placeholder = 'Search your entries…'; chatInput.focus(); }
        }
        // Hover effect
        item.classList.add('active');
        setTimeout(() => { item.classList.remove('active'); }, 200);
      });
      // Hover handled by CSS .chat-qa-item:hover
      
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

/**
 * Create a task from an explicit chat command (e.g. "Create a task: ...")
 * @param {string} title
 * @param {string} threadId - Chat thread ID for DERIVED_FROM edge
 */
async function _createChatTask(title, threadId) {
  try {
    const { createTask } = await import('../lib/graph/task-store.js');
    await createTask({
      title,
      assignee: 'me',
      action: 'CHAT_TASK',
      objective: `Created from chat conversation`,
    });
    toast.success('Task created', title.slice(0, 40));
  } catch (e) {
    console.warn('[Chat] Task creation failed:', e.message);
  }
}

/**
 * Create a note entry from an explicit chat command (e.g. "Save a note: ...")
 * @param {string} content
 */
async function _createChatNote(content) {
  try {
    const { saveEntry } = await import('../lib/storage.js');
    const title = content.split('\n')[0].slice(0, 80) || 'Chat Note';
    const entry = {
      id: generateId('note'),
      title,
      type: 'note',
      date: Date.now(),
      textContent: content,
      source: 'chat',
      tags: ['chat-note'],
    };
    await saveEntry(entry);
    toast.success('Note saved', title.slice(0, 40));
  } catch (e) {
    console.warn('[Chat] Note creation failed:', e.message);
  }
}

/**
 * Auto-extract action items from an AI response.
 * Looks for patterns like "- [ ] ...", "Action: ...", "TODO: ...", numbered action items.
 * Creates tasks silently — only toasts if tasks were found.
 * @param {string} response - AI response text
 * @param {string} threadId
 */
async function _extractTasksFromResponse(response, threadId) {
  if (!response || response.length < 30) return;

  // Patterns that indicate action items in AI responses
  const patterns = [
    /^[-*]\s*\[[ ]\]\s*(.+)$/gm,                       // - [ ] task
    /^(?:action|todo|task|follow.?up)\s*[:：]\s*(.+)$/gim, // Action: task
    /^\d+\.\s*\*\*(?:Action|Task|Follow.?up)\*\*\s*[:：]?\s*(.+)$/gm, // 1. **Action**: task
  ];

  const tasks = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const title = match[1].replace(/\*\*/g, '').trim();
      if (title.length >= 5 && title.length <= 200) {
        tasks.push(title);
      }
    }
  }

  // Deduplicate
  const unique = [...new Set(tasks)];
  if (!unique.length) return;

  // Create up to 5 tasks (prevent runaway extraction)
  try {
    const { createTask } = await import('../lib/graph/task-store.js');
    let created = 0;
    for (const title of unique.slice(0, 5)) {
      await createTask({
        title,
        assignee: 'me',
        action: 'CHAT_EXTRACTED',
        objective: 'Auto-extracted from chat conversation',
      });
      created++;
    }
    if (created > 0) {
      toast.info(`${created} ${created === 1 ? 'task' : 'tasks'} extracted`, 'Review in Tasks panel');
    }
  } catch (e) {
    console.warn('[Chat] Task extraction failed:', e.message);
  }
}
