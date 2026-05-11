// Takus — Ask Panel (Phase 2: Video-RAG)
// Persistent Ask bar above the history list; living wiki of saved Q&A pairs.
import { icons } from '../lib/icons.js';
import { getSettings } from './settings-panel.js';
import { getRecordings, getAllEmbeddings, saveWikiEntry, getWikiEntries, deleteWikiEntry } from '../lib/storage.js';
import { semanticSearch } from '../lib/embeddings.js';
import { generateAnswer } from '../lib/ai-engine.js';
import { toast } from './toast.js';
import { typeLabel, typeAccent } from './type-picker.js';

function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

/**
 * Render the Ask panel into `container`.
 * Async — fetches embedding status and wiki from IndexedDB before painting.
 * @param {HTMLElement} container
 */
export async function renderAskPanel(container) {
  const [allEmbeddings, wikiEntries] = await Promise.all([
    getAllEmbeddings().catch(() => []),
    getWikiEntries().catch(() => []),
  ]);

  const hasEmbeddings = allEmbeddings.some(e => e.chunks?.length > 0);
  const placeholder   = hasEmbeddings
    ? 'Ask your recordings…'
    : 'Ask your recordings… (process a recording with AI to enable)';

  container.innerHTML = `
    <div class="card card-compact animate-in ask-panel">
      <div class="ask-bar">
        <span class="ask-icon">${icons.search(16)}</span>
        <input
          type="text"
          id="ask-input"
          class="ask-input"
          placeholder="${esc(placeholder)}"
          autocomplete="off"
          ${!hasEmbeddings ? 'disabled' : ''}
        />
        <kbd class="ask-kbd">⌘K</kbd>
        <button id="ask-submit" class="btn btn-primary btn-sm" ${!hasEmbeddings ? 'disabled' : ''}>Ask</button>
      </div>
      <div id="ask-result" class="hidden"></div>
      ${wikiEntries.length ? `
        <div class="ask-wiki">
          <div class="ask-wiki-header">
            ${icons.zap(11)} <span>Saved answers</span>
            <span class="tasks-count">${wikiEntries.length}</span>
          </div>
          <div class="ask-wiki-list">
            ${wikiEntries.slice(0, 6).map(entry => `
              <div class="ask-wiki-entry" data-id="${esc(entry.id)}">
                <button class="ask-wiki-query" data-query="${esc(entry.query)}" title="${esc(entry.query)}">${esc(entry.query)}</button>
                <button class="ask-wiki-delete btn btn-ghost btn-icon btn-sm" data-id="${esc(entry.id)}" title="Remove">${icons.x(10)}</button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>`;

  const input     = container.querySelector('#ask-input');
  const submitBtn = container.querySelector('#ask-submit');
  const resultDiv = container.querySelector('#ask-result');

  if (!hasEmbeddings) return;

  const doSearch = async () => {
    const query = input.value.trim();
    if (!query) { input.focus(); return; }

    const settings  = getSettings();
    const provider  = settings.aiProvider || 'openai';
    const apiKey    = provider === 'gemini' ? settings.geminiKey : settings.openaiKey;
    if (!apiKey) {
      toast.warning('No API key', 'Add an API key in Settings to use Ask.');
      return;
    }

    // Show loading state
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = `
      <div class="ask-loading">
        <div class="ask-loading-dots"><span></span><span></span><span></span></div>
        <span style="font-size:var(--font-xs);color:var(--color-text-muted);">Searching recordings…</span>
      </div>`;

    submitBtn.disabled = true;
    input.disabled     = true;

    try {
      const [recordings, embeddingsData] = await Promise.all([
        getRecordings(),
        getAllEmbeddings(),
      ]);

      const topChunks = await semanticSearch(query, embeddingsData, apiKey, provider, 5);

      if (!topChunks.length) {
        resultDiv.innerHTML = `
          <div class="ask-answer-card">
            <p style="color:var(--color-text-muted);font-size:var(--font-sm);">No relevant recordings found for this query.</p>
          </div>`;
        return;
      }

      const answer  = await generateAnswer(query, topChunks, recordings, apiKey, provider);
      const sources = topChunks
        .map((r, i) => ({ idx: i + 1, rec: recordings.find(rec => rec.id === r.recordingId), chunk: r.chunk, score: r.score }))
        .filter(s => s.rec);

      resultDiv.innerHTML = `
        <div class="ask-answer-card">
          <div class="ask-answer-text">${esc(answer)}</div>
          ${sources.length ? `
            <div class="ask-sources">
              <span style="font-size:10px;color:var(--color-text-disabled);font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Sources</span>
              <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-1);">
                ${sources.map(s => {
                  const dateStr = s.rec.date ? new Date(s.rec.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
                  const tColor = typeAccent(s.rec.type || 'screen');
                  return `<div class="ask-source-chip" title="${esc(s.chunk.text.slice(0, 120))}">
                    <span style="color:${tColor};font-size:9px;">${esc(typeLabel(s.rec.type || 'screen').slice(0, 5))}</span>
                    <span>${esc(s.rec.title || 'Untitled')}</span>
                    ${dateStr ? `<span style="color:var(--color-text-disabled);font-size:9px;">${esc(dateStr)}</span>` : ''}
                    <span style="color:var(--color-text-disabled);">[${s.idx}]</span>
                  </div>`;
                }).join('')}
              </div>
            </div>
          ` : ''}
          <div style="display:flex;justify-content:flex-end;margin-top:var(--space-2);">
            <button id="ask-save-wiki" class="btn btn-ghost btn-sm" style="font-size:10px;">
              ${icons.checkSquare(11)} Save to Wiki
            </button>
          </div>
        </div>`;

      resultDiv.querySelector('#ask-save-wiki')?.addEventListener('click', async () => {
        const existing = await getWikiEntries().catch(() => []);
        const normalised = query.toLowerCase().trim();
        const dupe = existing.find(e => (e.query || '').toLowerCase().trim() === normalised);
        if (dupe) {
          toast.info('Already saved', 'This question is already in your Wiki.');
          return;
        }
        const entry = {
          id:      'wiki_' + Date.now(),
          date:    Date.now(),
          query,
          answer,
          sources: sources.map(s => ({ recordingId: s.rec.id, title: s.rec.title || 'Untitled' })),
        };
        await saveWikiEntry(entry).catch(() => {});
        toast.success('Saved to Wiki', 'Answer saved for future reference');
        renderAskPanel(container);
      });

    } catch (e) {
      console.warn('[Ask] Search failed:', e);
      resultDiv.innerHTML = `
        <div class="ask-answer-card">
          <p style="color:var(--color-text-muted);font-size:var(--font-sm);">Search failed: ${esc(e.message)}</p>
        </div>`;
    } finally {
      submitBtn.disabled = false;
      input.disabled     = false;
      input.focus();
    }
  };

  submitBtn.addEventListener('click', doSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  });

  // Wiki entry: click to re-run
  container.querySelectorAll('.ask-wiki-query').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.query;
      doSearch();
    });
  });

  // Wiki entry: delete
  container.querySelectorAll('.ask-wiki-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deleteWikiEntry(btn.dataset.id).catch(() => {});
      renderAskPanel(container);
    });
  });
}

/**
 * Focus the Ask input.  Called by the Cmd+K keyboard shortcut.
 * No-op if the panel is not visible or embeddings are not available.
 */
export function focusAskInput() {
  const input = document.getElementById('ask-input');
  if (input && !input.disabled) {
    input.focus();
    input.select();
  }
}
