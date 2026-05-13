// Takus — Watch Modal (extracted from history-panel.js)
// Full-screen video player with chapter navigation, synced transcript,
// transcript search, and keyboard controls.

import { esc, parseVTT } from '../lib/utils.js';

/**
 * Show a full-screen watch modal for a recording.
 *
 * @param {Blob}     blob         Video blob
 * @param {string}   title        Recording title
 * @param {Array}    chapters     Array of { title, seconds } objects
 * @param {number|null} startTime  Optional start timestamp in seconds
 * @param {string|null} vttString  Optional VTT subtitle content
 */
export function showWatchModal(blob, title, chapters = [], startTime = null, vttString = null) {
  document.getElementById('watch-overlay')?.remove();

  const url = URL.createObjectURL(blob);
  const segments = vttString ? parseVTT(vttString) : [];
  const hasTranscript = segments.length > 0;
  const overlay = document.createElement('div');
  overlay.id = 'watch-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-4);';

  const chaptersHtml = chapters.length
    ? `<div class="watch-chapters">
        ${chapters.map((c, i) => `
          <button class="watch-chapter-btn" data-seconds="${c.seconds}" title="Jump to ${_fmtSeconds(c.seconds)}">
            <span class="watch-chapter-index">${i + 1}</span>
            <span class="watch-chapter-title">${esc(c.title)}</span>
            <span class="watch-chapter-time">${_fmtSeconds(c.seconds)}</span>
          </button>`).join('')}
      </div>`
    : '';

  const transcriptPanelHtml = hasTranscript
    ? `<div class="watch-transcript-panel">
        <div class="watch-transcript-header">
          <span class="watch-transcript-title">Transcript</span>
          <input type="text" class="watch-transcript-search" placeholder="Search transcript…" autocomplete="off" />
        </div>
        <div class="watch-transcript-list" id="watch-tlist">
          ${segments.map((seg, i) => `
            <div class="transcript-row" data-idx="${i}" data-start="${seg.start}" data-end="${seg.end}">
              <span class="transcript-ts">${_fmtSeconds(Math.floor(seg.start))}</span>
              <span class="transcript-text">${esc(seg.text)}</span>
            </div>`).join('')}
        </div>
      </div>`
    : '';

  overlay.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--space-2);width:100%;max-width:${hasTranscript ? '1200px' : '960px'};">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);">
        <span style="font-weight:var(--weight-semi);color:#fff;font-size:var(--font-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(title)}</span>
        <button id="watch-close" style="flex-shrink:0;background:rgba(255,255,255,0.1);border:none;cursor:pointer;color:#fff;font-size:18px;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;" title="Close (Esc)">✕</button>
      </div>
      <div class="watch-layout">
        <div class="watch-video-col">
          <video id="watch-video" src="${url}" controls autoplay></video>
          ${chaptersHtml}
        </div>
        ${transcriptPanelHtml}
      </div>
      <p style="text-align:center;font-size:var(--font-xs);color:rgba(255,255,255,0.3);">Click outside or press <kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;">Esc</kbd> to close</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const video = overlay.querySelector('#watch-video');

  // Jump to start time if provided
  if (startTime !== null && startTime > 0) {
    video.addEventListener('loadedmetadata', () => { video.currentTime = startTime; }, { once: true });
  }

  // Chapter buttons
  overlay.querySelectorAll('.watch-chapter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      video.currentTime = Number(btn.dataset.seconds);
      video.play();
      overlay.querySelectorAll('.watch-chapter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ── Synced Transcript ──────────────────────────────────────────────────
  if (hasTranscript) {
    const tList = overlay.querySelector('#watch-tlist');
    const searchInput = overlay.querySelector('.watch-transcript-search');
    const rows = overlay.querySelectorAll('.transcript-row');
    let activeIdx = -1;
    let searchQuery = '';

    // Click-to-seek
    rows.forEach(row => {
      row.addEventListener('click', () => {
        video.currentTime = Number(row.dataset.start);
        video.play();
      });
    });

    // Live highlight on timeupdate (debounced via rAF)
    let _rafId = null;
    video.addEventListener('timeupdate', () => {
      if (_rafId) return;
      _rafId = requestAnimationFrame(() => {
        _rafId = null;
        const t = video.currentTime;
        let newIdx = -1;
        for (let i = 0; i < segments.length; i++) {
          if (t >= segments[i].start && t < segments[i].end) { newIdx = i; break; }
        }
        // Fallback: find the last segment that started before current time
        if (newIdx === -1) {
          for (let i = segments.length - 1; i >= 0; i--) {
            if (t >= segments[i].start) { newIdx = i; break; }
          }
        }
        if (newIdx !== activeIdx) {
          if (activeIdx >= 0 && rows[activeIdx]) rows[activeIdx].classList.remove('transcript-active');
          activeIdx = newIdx;
          if (activeIdx >= 0 && rows[activeIdx]) {
            rows[activeIdx].classList.add('transcript-active');
            if (!searchQuery) {
              rows[activeIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }
        }
      });
    });

    // Search within transcript
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      rows.forEach(row => {
        const textSpan = row.querySelector('.transcript-text');
        const segIdx = Number(row.dataset.idx);
        const originalText = segments[segIdx].text;

        if (!searchQuery) {
          row.style.display = '';
          row.classList.remove('transcript-match');
          textSpan.innerHTML = esc(originalText);
          return;
        }

        const lowerText = originalText.toLowerCase();
        if (lowerText.includes(searchQuery)) {
          row.style.display = '';
          row.classList.add('transcript-match');
          const escaped = esc(originalText);
          const escapedQuery = esc(searchQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          textSpan.innerHTML = escaped.replace(
            new RegExp(escapedQuery, 'gi'),
            m => `<mark>${m}</mark>`
          );
        } else {
          row.style.display = 'none';
          row.classList.remove('transcript-match');
        }
      });
    });

    // If startTime provided, scroll to that segment on open
    if (startTime !== null && startTime > 0) {
      requestAnimationFrame(() => {
        for (let i = 0; i < segments.length; i++) {
          if (startTime >= segments[i].start && startTime < segments[i].end) {
            rows[i]?.classList.add('transcript-active');
            rows[i]?.scrollIntoView({ block: 'center' });
            activeIdx = i;
            break;
          }
        }
      });
    }
  }

  // Cleanup
  const onEsc = (e) => { if (e.key === 'Escape') cleanup(); };
  const cleanup = () => {
    overlay.remove();
    URL.revokeObjectURL(url);
    document.removeEventListener('keydown', onEsc);
  };
  overlay.querySelector('#watch-close').addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
  document.addEventListener('keydown', onEsc);
}

function _fmtSeconds(s) {
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}
