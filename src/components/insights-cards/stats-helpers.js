// Takus — Insights: Stats Helpers (extracted from insights-panel.js)
// Pure rendering utilities for the insights dashboard cards.

import { esc, shortDate, MS_PER_WEEK } from '../../lib/utils.js';
import { icons } from '../../lib/icons.js';
import { typeLabel, typeAccent } from '../../lib/content-types.js';
import { formatDuration } from '../../lib/recorder.js';
import { extractTLDW } from '../../lib/analytics.js';

// ── Stat Cells & Charts ────────────────────────────────────────────────────

export function statCell(icon, value, label) {
  return `
    <div class="ins-stat-cell" style="padding:var(--space-2) 0;">
      <span style="color:var(--color-text-muted);">${icon}</span>
      <span class="ins-big-num">${esc(String(value))}</span>
      <span class="ins-muted-label">${label}</span>
    </div>`;
}

export function qualColor(score) {
  if (score >= 85) return 'var(--color-success)';
  if (score >= 70) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

export function sparkline(scores) {
  const W = 320, H = 56, pad = 4;
  const n = scores.length;
  if (n < 2) return '';
  const xStep = (W - pad * 2) / (n - 1);
  const yScale = (H - pad * 2) / 100;

  const pts = scores.map((v, i) => [pad + i * xStep, H - pad - v * yScale]);

  const areaPath = `M${pts[0][0]},${H - pad} ` +
    pts.map(p => `L${p[0]},${p[1]}`).join(' ') +
    ` L${pts[n-1][0]},${H - pad} Z`;

  const linePath = `M${pts.map(p => `${p[0]},${p[1]}`).join(' L')}`;

  const dots = pts.map((p, i) => {
    const color = qualColor(scores[i]);
    return `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${color}" stroke="var(--color-surface)" stroke-width="1.5"/>`;
  }).join('');

  return `
    <svg width="100%" viewBox="0 0 ${W} ${H}" fill="none" preserveAspectRatio="none" style="display:block;overflow:visible;">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--color-primary-light)" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="var(--color-primary-light)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#spark-grad)"/>
      <path d="${linePath}" stroke="var(--color-primary-light)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    </svg>`;
}

export function fillerBar(label, count, max, rank) {
  const pct = Math.max(4, Math.round((count / max) * 100));
  const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22d3ee'];
  const color = colors[rank] || '#6b7280';
  return `
    <div class="ins-bar-row">
      <span class="ins-bar-label">${esc(label)}</span>
      <div class="ins-bar-track">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>
      <span class="ins-bar-count">${count}×</span>
    </div>`;
}

export function decisionRow(task, entry, hasConflict = false) {
  const p = task.payload || {};
  const decision = p.decision || task.title || 'Decision';
  const owner = p.owner || task.assignee ? ` · ${esc(p.owner || task.assignee)}` : '';
  const dateStr = shortDate(entry.date);
  return `
    <div class="ins-digest-row" data-rec-id="${esc(entry.id)}" style="display:flex;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;">
      <span style="color:${hasConflict ? '#f59e0b' : 'var(--color-primary-light)'};flex-shrink:0;margin-top:1px;">${hasConflict ? icons.alertCircle(12) : icons.flag(12)}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:var(--font-xs);color:var(--color-text-primary);line-height:1.4;">${esc(decision)}${hasConflict ? ' <span class="conflict-inline-badge" title="May overlap with another decision">review</span>' : ''}</div>
        <div style="font-size:10px;color:var(--color-text-disabled);margin-top:2px;">
          ${esc(entry.title || 'Untitled')}${owner} · ${esc(dateStr)}
        </div>
      </div>
    </div>`;
}

// ── Conflict Detection ─────────────────────────────────────────────────────

export function detectConflicts(decisions) {
  const stop = new Set(['the','a','an','to','is','it','in','on','at','of','for','and','or','but','we','i','you','they','will','was','that','this','with','be','have','do','not','are','has','our','their','its','were','been','by','from','as','would','should','could','shall','about','which','when','what']);
  const tok = s => (s || '').toLowerCase().match(/\b[a-z]{4,}\b/g)?.filter(w => !stop.has(w)) || [];
  const conflicts = new Set();
  for (let i = 0; i < decisions.length; i++) {
    const aWords = new Set(tok(decisions[i].task.payload?.decision || decisions[i].task.title));
    if (aWords.size < 3) continue;
    for (let j = i + 1; j < decisions.length; j++) {
      if (decisions[i].entry.id === decisions[j].entry.id) continue;
      const bWords = tok(decisions[j].task.payload?.decision || decisions[j].task.title);
      const overlap = bWords.filter(w => aWords.has(w)).length;
      if (overlap >= 2 && (overlap / Math.max(aWords.size, bWords.length, 1)) > 0.3) {
        conflicts.add(i); conflicts.add(j);
      }
    }
  }
  return conflicts;
}

// ── Type Pie Donut ─────────────────────────────────────────────────────────

export function typePieDonut(typeCounts, total) {
  const entries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  if (!total || entries.length < 2) return '';

  const R = 30, CX = 38, CY = 38;
  const circ = 2 * Math.PI * R;
  let offset = 0, segments = '', legend = '';

  for (const [type, count] of entries) {
    const color = typeAccent(type);
    const frac = count / total;
    const dash = frac * circ;
    segments += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="9"
      stroke-dasharray="${dash.toFixed(2)} ${(circ-dash).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${CX} ${CY})"/>`;
    offset += dash;
    legend += `<div class="ins-legend-row">
      <span class="ins-legend-dot" style="background:${color};"></span>
      <span style="color:var(--color-text-secondary);">${esc(typeLabel(type))}</span>
      <span style="margin-left:auto;color:var(--color-text-muted);white-space:nowrap;">${count} <span style="color:var(--color-text-disabled);">(${Math.round(frac*100)}%)</span></span>
    </div>`;
  }

  return `
    <div class="card card-compact" style="display:flex;gap:var(--space-5);align-items:center;">
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
        <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="9"/>
        ${segments}
      </svg>
      <div style="flex:1;display:flex;flex-direction:column;gap:var(--space-2);">
        <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-1);">${icons.pieChart(12)} Content Types</div>
        ${legend}
      </div>
    </div>`;
}

// ── Activity Heatmap ───────────────────────────────────────────────────────

export function activityHeatmap(entries) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dateCounts = {};
  for (const r of entries) {
    const d = new Date(r.date);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    dateCounts[key] = (dateCounts[key] || 0) + 1;
  }

  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364 - startDate.getDay());

  const CELL = 11, GAP = 3, STEP = CELL + GAP;
  const COLS = 53, ROWS = 7;
  const W = COLS * STEP + 2, H = ROWS * STEP + 22;

  const levelColors = [
    'rgba(255,255,255,0.05)',
    'rgba(124,58,237,0.22)',
    'rgba(124,58,237,0.48)',
    'rgba(124,58,237,0.70)',
    'rgba(124,58,237,0.92)',
  ];

  const { current: currentStreak, total: activeDays } = computeStreak(dateCounts, today);
  const busiestWeekStr = busiestWeek(dateCounts);

  let cells = '';
  let monthLabels = '';
  const seenMonths = new Set();

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + col * 7 + row);
      if (d > today) continue;

      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const count = dateCounts[key] || 0;
      const color = levelColors[Math.min(4, count)];
      const x = col * STEP + 1, y = 20 + row * STEP;
      const tip = count === 0 ? 'No entries' : `${count} entry${count !== 1 ? 's' : ''}`;
      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${color}" data-date="${key}" role="img" aria-label="${key}: ${tip}" style="${count > 0 ? 'cursor:pointer;' : ''}"><title>${key}: ${tip} — click to filter history</title></rect>`;

      if (row === 0) {
        const mKey = `${d.getFullYear()}-${d.getMonth()}`;
        if (!seenMonths.has(mKey) && col > 0) {
          seenMonths.add(mKey);
          monthLabels += `<text x="${x}" y="13" font-size="9" fill="rgba(255,255,255,0.35)" font-family="system-ui,sans-serif">${d.toLocaleDateString(undefined,{month:'short'})}</text>`;
        }
      }
    }
  }

  const legend = levelColors.map(c =>
    `<span style="width:9px;height:9px;border-radius:2px;background:${c};display:inline-block;flex-shrink:0;"></span>`
  ).join('');

  return `
    <div class="card card-compact" id="heatmap-card">
      <div class="ins-section-title">${icons.calendar(12)} Activity — Past Year</div>
      <div style="overflow-x:auto;">
        <svg class="heatmap-svg" viewBox="0 0 ${W} ${H}" style="width:100%;min-width:320px;display:block;" aria-label="Activity over the past year — click a day to filter library">
          ${monthLabels}
          ${cells}
        </svg>
      </div>
      <div class="flex-between flex-wrap gap-3" style="margin-top:var(--space-2);">
        <div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;">
          ${currentStreak > 1 ? `<span style="font-size:var(--font-xs);color:var(--color-primary-light);font-weight:var(--weight-semi);">🔥 ${currentStreak}-day streak</span>` : ''}
          <span style="font-size:10px;color:rgba(255,255,255,0.3);">${activeDays} active day${activeDays !== 1 ? 's' : ''} this year</span>
          ${busiestWeekStr ? `<span style="font-size:9px;color:rgba(255,255,255,0.22);">Peak: ${esc(busiestWeekStr)}</span>` : ''}
        </div>
        <div class="ins-heatmap-legend">
          <span style="font-size:9px;color:rgba(255,255,255,0.3);">Less</span>
          ${legend}
          <span style="font-size:9px;color:rgba(255,255,255,0.3);">More</span>
        </div>
      </div>
    </div>`;
}

export function computeStreak(dateCounts, today) {
  const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const total = Object.keys(dateCounts).length;
  let startDay = new Date(today);
  if (!dateCounts[dateKey(startDay)]) startDay.setDate(startDay.getDate() - 1);
  let current = 0;
  for (let i = 0; i < 366; i++) {
    const d = new Date(startDay); d.setDate(startDay.getDate() - i);
    if (dateCounts[dateKey(d)]) { current++; } else { break; }
  }
  return { current, total };
}

export function weeklyDigest(entries, { openTasks = 0, decisionCount = 0 } = {}) {
  const weekAgo = Date.now() - MS_PER_WEEK;
  const thisWeek = entries.filter(r => new Date(r.date).getTime() >= weekAgo).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (!thisWeek.length) return '';

  const totalDur = thisWeek.reduce((n, r) => n + (r.duration || 0), 0);

  return `
    <div class="card card-compact">
      <div class="flex-between flex-wrap gap-2" class="mb-3">
        <span class="ins-section-title">${icons.calendar(12)} This Week</span>
        <div style="display:flex;align-items:center;gap:var(--space-3);font-size:10px;">
          <span style="color:var(--color-text-disabled);">${thisWeek.length} entry${thisWeek.length !== 1 ? 's' : ''} · ${formatDuration(totalDur)}</span>
          ${openTasks    ? `<span style="color:#f59e0b;">${openTasks} open task${openTasks !== 1 ? 's' : ''}</span>` : ''}
          ${decisionCount ? `<span style="color:var(--color-primary-light);">${decisionCount} decision${decisionCount !== 1 ? 's' : ''}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-2);">
        ${thisWeek.slice(0, 5).map(r => {
          const tldw   = extractTLDW(r.aiSummary);
          const tColor = typeAccent(r.type || 'screen');
          return `
            <div class="ins-digest-card" data-rec-id="${esc(r.id)}">
              <div class="flex-center gap-2">
                <span style="width:3px;height:12px;border-radius:2px;background:${tColor};flex-shrink:0;"></span>
                <span style="font-size:var(--font-xs);color:var(--color-text-primary);font-weight:var(--weight-semi);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.title || 'Untitled')}</span>
                <span style="font-size:9px;color:var(--color-text-disabled);flex-shrink:0;">${shortDate(r.date)}</span>
              </div>
              ${tldw.length ? `
                <ul style="margin:var(--space-1) 0 0 var(--space-4);padding:0;list-style:disc;">
                  ${tldw.slice(0, 2).map(b => `<li style="font-size:10px;color:var(--color-text-muted);line-height:1.45;">${esc(b)}</li>`).join('')}
                </ul>` : !r.aiSummary ? `<p style="font-size:10px;color:var(--color-text-disabled);margin:4px 0 0 var(--space-4);">No AI summary yet</p>` : ''}
            </div>`;
        }).join('')}
        ${thisWeek.length > 5 ? `<p style="font-size:10px;color:var(--color-text-disabled);text-align:center;margin-top:var(--space-1);">+ ${thisWeek.length - 5} more this week</p>` : ''}
      </div>
    </div>`;
}

export function busiestWeek(dateCounts) {
  const keys = Object.keys(dateCounts);
  if (keys.length < 3) return '';
  const seen = new Set();
  let best = 0, bestStart = null;
  for (const key of keys) {
    const d = new Date(key);
    const sun = new Date(d);
    sun.setDate(d.getDate() - d.getDay());
    const sunKey = `${sun.getFullYear()}-${sun.getMonth()}-${sun.getDate()}`;
    if (seen.has(sunKey)) continue;
    seen.add(sunKey);
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const day = new Date(sun); day.setDate(sun.getDate() + i);
      const k = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
      total += dateCounts[k] || 0;
    }
    if (total > best) { best = total; bestStart = new Date(sun); }
  }
  if (!bestStart || best < 2) return '';
  const bestEnd = new Date(bestStart); bestEnd.setDate(bestStart.getDate() + 6);
  const fmt = { month: 'short', day: 'numeric' };
  return `${bestStart.toLocaleDateString(undefined, fmt)}–${bestEnd.toLocaleDateString(undefined, fmt)} (${best})`;
}
