// Takus — History Panel Utilities (Phase 71: Decomposition)
// Pure functions extracted from history-panel.js to reduce monolith complexity.
// These have zero closure dependencies — they operate only on their arguments.

import { esc } from '../lib/utils.js';
import { icons } from '../lib/icons.js';
import { typeLabel, typeAccent } from './type-picker.js';
import { contentCategory } from '../lib/schema-validator.js';
import { extractTLDW } from '../lib/analytics.js';
import { cosineSimilarity } from '../lib/embeddings.js';
import { getKnowledgeLevelInfo } from '../lib/knowledge-level.js';
import { averageEmbedding } from '../lib/graph/vector-utils.js';
import { timeAgo as _utilsTimeAgo } from '../lib/utils.js';

// ── Badges ──────────────────────────────────────────────────────────────────

export function typeBadge(type) {
  if (!type) return '';
  const label = typeLabel(type);
  const color = typeAccent(type);
  return `<span style="font-size:10px;font-weight:600;color:${color};background:${color}22;padding:1px 6px;border-radius:10px;white-space:nowrap;" title="Recording type">${label}</span>`;
}

export function archiveBadge(r) {
  const status = r.archiveStatus;
  if (!status || status === 'active') return '';
  const badges = {
    pending:  { label: 'Archiving…', color: '#f59e0b' },
    archived: { label: 'Archived',   color: '#8b5cf6' },
    cold:     { label: 'Cold Storage', color: '#6366f1' },
  };
  const b = badges[status];
  if (!b) return '';
  return ` · <span style="font-size:10px;font-weight:600;color:${b.color};white-space:nowrap;" title="Archive status: ${status}">${b.label}</span>`;
}

export function stateBadge(r) {
  if (!r.state || r.state === 'active') return '';
  if (contentCategory(r.type) === 'document') return `<span style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:4px;background:rgba(34,197,94,0.15);color:#22c55e;white-space:nowrap;">📄 ${typeLabel(r.type)}</span>`;
  const badges = {
    raw:        { label: '📥 Inbox',       bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
    processing: { label: '⏳ Processing', bg: 'rgba(99,102,241,0.12)', color: '#818cf8' },
    condensed:  { label: '📦 Condensed',   bg: 'rgba(139,92,246,0.12)', color: '#a78bfa' },
  };
  const b = badges[r.state];
  if (!b) return '';
  return `<span style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:4px;background:${b.bg};color:${b.color};white-space:nowrap;">${b.label}</span>`;
}

// ── Content ─────────────────────────────────────────────────────────────────

export function tldwStrip(r) {
  if (!r.aiSummary) return '';
  const bullets = extractTLDW(r.aiSummary);
  if (!bullets.length) return '';
  return `
    <div class="tldw-strip" data-id="${r.id}">
      ${bullets.map(b => `<span class="tldw-bullet">${icons.arrowRight(9)} ${esc(b)}</span>`).join('')}
    </div>`;
}

export function metaTags(r) {
  const tags = [];

  if (r.device) {
    tags.push(`<span class="history-tag history-tag--device" title="Recorded on ${esc(r.device)}">${icons.cpu(10)} ${esc(r.device)}</span>`);
  }

  const cloud = cloudLabel(r.driveLink);
  if (cloud) {
    tags.push(`<span class="history-tag history-tag--cloud" title="Stored in ${cloud}">${icons.cloud(10)} ${cloud}</span>`);
  } else {
    tags.push(`<span class="history-tag" title="Saved locally">${icons.hardDrive(10)} Local</span>`);
  }

  if (r.aiProvider || r.aiSummary) {
    const aiLabel = r.aiProvider === 'gemini' ? 'Gemini' : r.aiProvider === 'openai' ? 'OpenAI' : 'AI';
    tags.push(`<span class="history-tag history-tag--ai" title="Processed with ${aiLabel}">${icons.zap(10)} ${aiLabel}</span>`);
  }

  if (r.analytics?.score) {
    const { score, label, color } = r.analytics.score;
    tags.push(`<span class="history-tag" style="color:${color};background:${color}18;border-color:${color}33;" title="Recording quality: ${label} (${score}/100)">${icons.shield(10)} ${score}</span>`);
  }

  if (r.knowledgeLevel) {
    const kl = getKnowledgeLevelInfo(r.knowledgeLevel);
    tags.push(`<span class="history-tag" style="color:${kl.color};background:${kl.color}14;border-color:${kl.color}28;" title="${kl.description}">${r.knowledgeLevel} ${kl.label}</span>`);
  }

  if (r.analytics?.fillerWords?.total > 0) {
    const fw = r.analytics.fillerWords;
    if (fw.rating === 'needs_work' || fw.rating === 'fair') {
      tags.push(`<span class="history-tag" style="color:#f59e0b;background:rgba(245,158,11,0.1);" title="${fw.total} filler words · ${fw.perMinute}/min">${icons.alertTriangle(10)} ${fw.perMinute}/min</span>`);
    }
  }

  if (!tags.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${tags.join('')}</div>`;
}

export function cloudLabel(driveLink) {
  if (!driveLink || !driveLink.startsWith('https://')) return null;
  if (driveLink.includes('drive.google.com') || driveLink.includes('docs.google.com')) return 'Google Drive';
  if (driveLink.includes('onedrive') || driveLink.includes('sharepoint') || driveLink.includes('1drv')) return 'OneDrive';
  return 'Cloud';
}

// ── Text Utilities ──────────────────────────────────────────────────────────

export function highlight(text, query) {
  const escaped = esc(text);
  if (!query) return escaped;
  const escapedQuery = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(
    new RegExp(escapedQuery, 'gi'),
    m => `<mark style="background:rgba(253,224,71,0.28);color:inherit;border-radius:2px;padding:0 1px;">${m}</mark>`,
  );
}

export function timeAgo(date) {
  return _utilsTimeAgo(date);
}

export function secToTimestamp(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ── Sorting & Filtering ─────────────────────────────────────────────────────

export function sortFn(mode) {
  if (mode === 'oldest')   return (a, b) => (a.date || 0) - (b.date || 0);
  if (mode === 'duration') return (a, b) => (b.duration || 0) - (a.duration || 0);
  if (mode === 'quality')  return (a, b) => (b.analytics?.score?.score || 0) - (a.analytics?.score?.score || 0);
  if (mode === 'size')     return (a, b) => (b.size || 0) - (a.size || 0);
  return (a, b) => (b.date || 0) - (a.date || 0);
}

export function filterByDate(list, filter) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === 'today') {
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    return list.filter(r => r.date >= today.getTime() && r.date < tomorrow.getTime());
  }
  if (filter === 'week') {
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 6);
    return list.filter(r => r.date >= weekAgo.getTime());
  }
  if (filter === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return list.filter(r => r.date >= monthStart.getTime());
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(filter)) {
    const [y, m, d] = filter.split('-').map(Number);
    const dayStart = new Date(y, m - 1, d);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    return list.filter(r => r.date >= dayStart.getTime() && r.date < dayEnd.getTime());
  }
  return list;
}

// ── Related Recordings ──────────────────────────────────────────────────────

export function computeRelated(contentId, allEmbeddings, entries, topN = 2) {
  const srcEntry = allEmbeddings.find(e => e.contentId === contentId);
  if (!srcEntry?.chunks?.length) return [];
  const srcMean = meanEmb(srcEntry.chunks);
  if (!srcMean) return [];

  const scored = [];
  for (const entry of allEmbeddings) {
    if (entry.contentId === contentId || !entry.chunks?.length) continue;
    const mean = meanEmb(entry.chunks);
    if (!mean) continue;
    const score = cosineSimilarity(srcMean, mean);
    if (score > 0.35) {
      const rec = entries.find(r => r.id === entry.contentId);
      if (rec) scored.push({ ...rec, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}

export function meanEmb(chunks) {
  return averageEmbedding(chunks);
}

// ── Transcript Viewer ───────────────────────────────────────────────────────

export function renderTranscriptViewer(segments, contentId) {
  if (!segments.length) return '<p style="color:var(--color-text-muted);font-size:var(--font-xs);">No transcript segments available.</p>';
  return `<div style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">` +
    segments.map(seg => `
      <div style="display:flex;gap:var(--space-2);font-size:var(--font-xs);line-height:1.5;">
        <button class="inline-ts-btn" data-entry-id="${esc(contentId || '')}" data-start-sec="${seg.start}" style="flex-shrink:0;font-variant-numeric:tabular-nums;color:var(--color-primary-light);font-weight:var(--weight-semi);padding:0 2px;background:none;border:none;cursor:pointer;font-size:inherit;font-family:inherit;border-radius:3px;transition:background 0.15s;" title="Watch at ${secToTimestamp(seg.start)}">${secToTimestamp(seg.start)}</button>
        <span style="color:var(--color-text-secondary);">${esc(seg.text)}</span>
      </div>`).join('') +
    '</div>';
}
