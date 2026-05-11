// Takus — Insights Panel (Phase 5: CORTEX — Cross-Recording Intelligence)
// Pure browser computation on existing IndexedDB data. Zero network cost.

import { getRecordings, deleteRecordingBlob } from '../lib/storage.js';
import { icons } from '../lib/icons.js';
import { formatDuration } from '../lib/recorder.js';
import { typeLabel, typeAccent } from './type-picker.js';
import { toast } from './toast.js';
import { extractTLDW } from '../lib/analytics.js';

const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/**
 * Render the Insights dashboard into `container`.
 * Async — reads all recordings from IndexedDB before painting.
 */
export async function renderInsightsPanel(container) {
  const recordings = await getRecordings().catch(() => []);

  if (!recordings.length) {
    container.innerHTML = `
      <div class="card card-compact animate-in" style="text-align:center;padding:var(--space-8) var(--space-4);">
        ${icons.barChart(28)}
        <p style="margin-top:var(--space-3);color:var(--color-text-muted);font-size:var(--font-sm);">No recordings yet — insights appear after your first session.</p>
      </div>`;
    return;
  }

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const totalDuration  = recordings.reduce((s, r) => s + (r.duration || 0), 0);
  const withAI         = recordings.filter(r => r.aiSummary).length;
  const withTasks      = recordings.filter(r =>
    (r.tasks?.takusTasks?.length || 0) + (r.tasks?.meTasks?.length || 0) > 0
  ).length;

  const typeCounts = {};
  for (const r of recordings) {
    const t = r.type || 'screen';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];

  // ── Quality trend (last 10 scored recordings, chronological) ─────────────
  const scored = recordings
    .filter(r => r.analytics?.score?.score != null)
    .slice(0, 10)
    .reverse();

  // ── Filler word aggregate ─────────────────────────────────────────────────
  const fillerTotals = {};
  for (const r of recordings) {
    for (const f of r.analytics?.fillerWords?.breakdown || []) {
      fillerTotals[f.label] = (fillerTotals[f.label] || 0) + f.count;
    }
  }
  const topFillers = Object.entries(fillerTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const avgQuality = scored.length
    ? Math.round(scored.reduce((s, r) => s + r.analytics.score.score, 0) / scored.length)
    : null;

  // ── Decision ledger ───────────────────────────────────────────────────────
  const decisions = [];
  for (const r of recordings) {
    for (const t of r.tasks?.takusTasks || []) {
      if (t.action === 'LOG_DECISION') {
        decisions.push({ task: t, recording: r });
      }
    }
  }
  decisions.sort((a, b) => new Date(b.recording.date) - new Date(a.recording.date));

  // ── Storage health ────────────────────────────────────────────────────────
  const storageEst = await navigator.storage?.estimate().catch(() => null);
  const OLD_THRESHOLD = 30 * 24 * 3600 * 1000;
  const oldRecordings = recordings.filter(r => Date.now() - r.date > OLD_THRESHOLD);
  const oldBlobMb = Math.round(oldRecordings.reduce((s, r) => s + (r.size || 0), 0) / 1024 / 1024);
  const usedMb  = storageEst ? Math.round(storageEst.usage  / 1024 / 1024) : null;
  const quotaGb = storageEst ? (storageEst.quota / 1024 / 1024 / 1024).toFixed(1) : null;
  const usedPct = storageEst ? Math.min(100, Math.round((storageEst.usage / storageEst.quota) * 100)) : 0;

  // ── Render ────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="animate-in" style="display:flex;flex-direction:column;gap:var(--space-4);">

      <!-- Weekly digest -->
      ${_weeklyDigest(recordings)}

      <!-- Activity heatmap -->
      ${_activityHeatmap(recordings)}

      <!-- Stats strip -->
      <div class="card card-compact">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-3);text-align:center;">
          ${_statCell(icons.video(16), recordings.length, 'Recordings')}
          ${_statCell(icons.clock(16), formatDuration(totalDuration), 'Recorded')}
          ${_statCell(icons.zap(16), withAI, 'AI Processed')}
          ${_statCell(icons.checkSquare(16), withTasks, 'With Tasks')}
        </div>
      </div>

      <!-- Quality trend + top type -->
      <div style="display:grid;grid-template-columns:1fr auto;gap:var(--space-4);align-items:start;">

        <!-- Sparkline -->
        ${scored.length >= 2 ? `
          <div class="card card-compact">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
              <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${icons.trendingUp(12)} Quality Trend${avgQuality != null ? ` — avg <strong style="color:${_qualColor(avgQuality)}">${avgQuality}</strong>` : ''}</span>
              <span style="font-size:10px;color:var(--color-text-disabled);">last ${scored.length}</span>
            </div>
            ${_sparkline(scored.map(r => r.analytics.score.score))}
            <div style="display:flex;justify-content:space-between;margin-top:4px;">
              ${scored.map(r => `<span style="font-size:9px;color:var(--color-text-disabled);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48px;" title="${esc(r.title || '')}">${esc(_shortDate(r.date))}</span>`).join('')}
            </div>
          </div>` : `<div></div>`}

        <!-- Top type + filler badge -->
        <div style="display:flex;flex-direction:column;gap:var(--space-3);">
          ${topType ? `
            <div class="card card-compact" style="text-align:center;min-width:110px;">
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:4px;">Top type</div>
              <div style="font-weight:var(--weight-semi);color:${typeAccent(topType[0])};font-size:var(--font-sm);">${typeLabel(topType[0])}</div>
              <div style="font-size:10px;color:var(--color-text-disabled);">${topType[1]} of ${recordings.length}</div>
            </div>` : ''}
          ${avgQuality != null ? `
            <div class="card card-compact" style="text-align:center;">
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:4px;">${icons.shield(12)} Avg quality</div>
              <div style="font-weight:var(--weight-bold);font-size:20px;color:${_qualColor(avgQuality)};">${avgQuality}</div>
            </div>` : ''}
        </div>
      </div>

      <!-- Type breakdown donut -->
      ${_typePieDonut(typeCounts, recordings.length)}

      <!-- Filler word leaderboard -->
      ${topFillers.length ? `
        <div class="card card-compact">
          <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-3);">${icons.alertTriangle(12)} Filler Words (all recordings)</div>
          <div style="display:flex;flex-direction:column;gap:var(--space-2);">
            ${topFillers.map(([label, count], i) => _fillerBar(label, count, topFillers[0][1], i)).join('')}
          </div>
        </div>` : ''}

      <!-- Decision ledger -->
      ${decisions.length ? (() => {
        const conflictSet = _detectConflicts(decisions);
        const conflictCount = conflictSet.size;
        return `
        <div class="card card-compact">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
            <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${icons.bookOpen(12)} Decision Ledger</span>
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              ${conflictCount > 0 ? `<span class="conflict-badge" title="${conflictCount} decision${conflictCount !== 1 ? 's' : ''} may overlap with another — review for conflicts">${icons.alertCircle(10)} ${conflictCount} to review</span>` : ''}
              <span class="badge badge-neutral">${decisions.length}</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--space-2);max-height:320px;overflow-y:auto;">
            ${decisions.slice(0, 20).map(({ task, recording }, idx) => _decisionRow(task, recording, conflictSet.has(idx))).join('')}
          </div>
          ${decisions.length > 20 ? `<p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:var(--space-2);text-align:center;">+ ${decisions.length - 20} more decisions</p>` : ''}
        </div>`;
      })() : `
        <div class="card card-compact" style="text-align:center;padding:var(--space-6);">
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);">No logged decisions yet. Ask AI to extract decisions during meeting recordings.</p>
        </div>`}

      <!-- Storage health -->
      <div class="card card-compact">
        <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-3);">${icons.hardDrive(12)} Storage Health</div>
        ${usedMb != null ? `
          <div style="margin-bottom:var(--space-3);">
            <div style="display:flex;justify-content:space-between;font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:6px;">
              <span>IndexedDB used</span>
              <span>${usedMb} MB${quotaGb ? ` / ${quotaGb} GB` : ''}</span>
            </div>
            <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
              <div style="width:${usedPct}%;height:100%;background:${usedPct > 80 ? 'var(--color-danger)' : 'var(--color-primary-light)'};border-radius:2px;transition:width 0.4s;"></div>
            </div>
          </div>` : ''}
        ${oldRecordings.length ? `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);">
            <span style="font-size:var(--font-xs);color:var(--color-text-muted);">${oldRecordings.length} video${oldRecordings.length !== 1 ? 's' : ''} older than 30 days${oldBlobMb > 0 ? ` (~${oldBlobMb} MB)` : ''}</span>
            <button id="ins-cleanup-btn" class="btn btn-ghost btn-sm" style="font-size:var(--font-xs);flex-shrink:0;">${icons.trash(11)} Free space</button>
          </div>` : `
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);">No recordings older than 30 days.</p>`}
      </div>

    </div>`;

  // Heatmap drill-down — click a day cell to filter History to that date
  container.querySelector('.heatmap-svg')?.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-date]');
    if (!cell?.dataset?.date) return;
    document.dispatchEvent(new CustomEvent('takus:datefilter', { detail: { date: cell.dataset.date } }));
  });

  // Storage cleanup button
  container.querySelector('#ins-cleanup-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner" style="width:10px;height:10px;border-width:2px;"></div> Cleaning…`;
    try {
      await Promise.all(oldRecordings.map(r => deleteRecordingBlob(r.id).catch(() => {})));
      toast.success('Storage freed', `Removed local videos for ${oldRecordings.length} old recording${oldRecordings.length !== 1 ? 's' : ''}`);
      renderInsightsPanel(container);
    } catch (err) {
      toast.error('Cleanup failed', err.message);
      btn.disabled = false;
    }
  });
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _statCell(icon, value, label) {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:var(--space-2) 0;">
      <span style="color:var(--color-text-muted);">${icon}</span>
      <span style="font-size:var(--font-md);font-weight:var(--weight-bold);color:var(--color-text-primary);">${esc(String(value))}</span>
      <span style="font-size:10px;color:var(--color-text-disabled);">${label}</span>
    </div>`;
}

function _sparkline(scores) {
  const W = 320, H = 56, pad = 4;
  const n = scores.length;
  if (n < 2) return '';
  const xStep = (W - pad * 2) / (n - 1);
  const yScale = (H - pad * 2) / 100;

  const pts = scores.map((v, i) => [pad + i * xStep, H - pad - v * yScale]);

  // Gradient area path
  const areaPath = `M${pts[0][0]},${H - pad} ` +
    pts.map(p => `L${p[0]},${p[1]}`).join(' ') +
    ` L${pts[n-1][0]},${H - pad} Z`;

  const linePath = `M${pts.map(p => `${p[0]},${p[1]}`).join(' L')}`;

  const dots = pts.map((p, i) => {
    const color = _qualColor(scores[i]);
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

function _fillerBar(label, count, max, rank) {
  const pct = Math.max(4, Math.round((count / max) * 100));
  const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22d3ee'];
  const color = colors[rank] || '#6b7280';
  return `
    <div style="display:flex;align-items:center;gap:var(--space-2);">
      <span style="font-size:var(--font-xs);color:var(--color-text-secondary);min-width:56px;text-align:right;">${esc(label)}</span>
      <div style="flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>
      <span style="font-size:var(--font-xs);color:var(--color-text-muted);min-width:28px;">${count}×</span>
    </div>`;
}

function _decisionRow(task, recording, hasConflict = false) {
  const p = task.payload || {};
  const decision = p.decision || task.title;
  const owner = p.owner ? ` · ${esc(p.owner)}` : '';
  const dateStr = _shortDate(recording.date);
  return `
    <div style="display:flex;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <span style="color:${hasConflict ? '#f59e0b' : 'var(--color-primary-light)'};flex-shrink:0;margin-top:1px;">${hasConflict ? icons.alertCircle(12) : icons.flag(12)}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:var(--font-xs);color:var(--color-text-primary);line-height:1.4;">${esc(decision)}${hasConflict ? ' <span class="conflict-inline-badge" title="May overlap with another decision">review</span>' : ''}</div>
        <div style="font-size:10px;color:var(--color-text-disabled);margin-top:2px;">
          ${esc(recording.title || 'Untitled')}${owner} · ${esc(dateStr)}
        </div>
      </div>
    </div>`;
}

function _qualColor(score) {
  if (score >= 85) return 'var(--color-success)';
  if (score >= 70) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function _shortDate(dateVal) {
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function _activityHeatmap(recordings) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dateCounts = {};
  for (const r of recordings) {
    const d = new Date(r.date);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    dateCounts[key] = (dateCounts[key] || 0) + 1;
  }

  // Start from the Sunday of the week 52 weeks back
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

  // Streak
  const { current: currentStreak, total: activeDays } = _computeStreak(dateCounts, today);

  // Busiest week
  const busiestWeekStr = _busiestWeek(dateCounts);

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
      const tip = count === 0 ? 'No recordings' : `${count} recording${count !== 1 ? 's' : ''}`;
      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${color}" data-date="${key}" style="${count > 0 ? 'cursor:pointer;' : ''}"><title>${key}: ${tip} — click to filter history</title></rect>`;

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
      <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-3);">${icons.calendar(12)} Activity — Past Year</div>
      <div style="overflow-x:auto;">
        <svg class="heatmap-svg" viewBox="0 0 ${W} ${H}" style="width:100%;min-width:320px;display:block;" aria-label="Recording activity over the past year — click a day to filter history">
          ${monthLabels}
          ${cells}
        </svg>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);margin-top:var(--space-2);">
        <div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;">
          ${currentStreak > 1 ? `<span style="font-size:var(--font-xs);color:var(--color-primary-light);font-weight:var(--weight-semi);">🔥 ${currentStreak}-day streak</span>` : ''}
          <span style="font-size:10px;color:rgba(255,255,255,0.3);">${activeDays} active day${activeDays !== 1 ? 's' : ''} this year</span>
          ${busiestWeekStr ? `<span style="font-size:9px;color:rgba(255,255,255,0.22);">Peak: ${esc(busiestWeekStr)}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="font-size:9px;color:rgba(255,255,255,0.3);">Less</span>
          ${legend}
          <span style="font-size:9px;color:rgba(255,255,255,0.3);">More</span>
        </div>
      </div>
    </div>`;
}

function _computeStreak(dateCounts, today) {
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

function _weeklyDigest(recordings) {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const thisWeek = recordings.filter(r => r.date >= weekAgo).sort((a, b) => b.date - a.date);
  if (!thisWeek.length) return '';

  const openTasks    = thisWeek.reduce((n, r) => n + (r.tasks?.meTasks?.filter(t => !t.done)?.length || 0), 0);
  const decisionCount = thisWeek.reduce((n, r) => n + (r.tasks?.takusTasks?.filter(t => t.action === 'LOG_DECISION')?.length || 0), 0);
  const totalDur     = thisWeek.reduce((n, r) => n + (r.duration || 0), 0);

  return `
    <div class="card card-compact">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-3);">
        <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${icons.calendar(12)} This Week</span>
        <div style="display:flex;align-items:center;gap:var(--space-3);font-size:10px;">
          <span style="color:var(--color-text-disabled);">${thisWeek.length} recording${thisWeek.length !== 1 ? 's' : ''} · ${formatDuration(totalDur)}</span>
          ${openTasks    ? `<span style="color:#f59e0b;">${openTasks} open task${openTasks !== 1 ? 's' : ''}</span>` : ''}
          ${decisionCount ? `<span style="color:var(--color-primary-light);">${decisionCount} decision${decisionCount !== 1 ? 's' : ''}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-2);">
        ${thisWeek.slice(0, 5).map(r => {
          const tldw   = extractTLDW(r.aiSummary);
          const tColor = typeAccent(r.type || 'screen');
          return `
            <div style="padding:var(--space-2);background:rgba(255,255,255,0.02);border-radius:var(--radius-md);border:1px solid rgba(255,255,255,0.05);">
              <div style="display:flex;align-items:center;gap:var(--space-2);">
                <span style="width:3px;height:12px;border-radius:2px;background:${tColor};flex-shrink:0;"></span>
                <span style="font-size:var(--font-xs);color:var(--color-text-primary);font-weight:var(--weight-semi);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.title || 'Untitled')}</span>
                <span style="font-size:9px;color:var(--color-text-disabled);flex-shrink:0;">${_shortDate(r.date)}</span>
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

function _busiestWeek(dateCounts) {
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

function _detectConflicts(decisions) {
  const stop = new Set(['the','a','an','to','is','it','in','on','at','of','for','and','or','but','we','i','you','they','will','was','that','this','with','be','have','do','not','are','has','our','their','its','were','been','by','from','as','would','should','could','shall','about','which','when','what']);
  const tok = s => (s || '').toLowerCase().match(/\b[a-z]{4,}\b/g)?.filter(w => !stop.has(w)) || [];
  const conflicts = new Set();
  for (let i = 0; i < decisions.length; i++) {
    const aWords = new Set(tok(decisions[i].task.payload?.decision || decisions[i].task.title));
    if (aWords.size < 3) continue;
    for (let j = i + 1; j < decisions.length; j++) {
      if (decisions[i].recording.id === decisions[j].recording.id) continue;
      const bWords = tok(decisions[j].task.payload?.decision || decisions[j].task.title);
      const overlap = bWords.filter(w => aWords.has(w)).length;
      if (overlap >= 2 && (overlap / Math.max(aWords.size, bWords.length, 1)) > 0.3) {
        conflicts.add(i); conflicts.add(j);
      }
    }
  }
  return conflicts;
}

function _typePieDonut(typeCounts, total) {
  const entries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  if (!total || entries.length < 2) return '';

  const TYPE_COLORS = { meeting: '#7c3aed', screen: '#3b82f6', presentation: '#10b981', update: '#f59e0b' };
  const R = 30, CX = 38, CY = 38;
  const circ = 2 * Math.PI * R;
  let offset = 0, segments = '', legend = '';

  for (const [type, count] of entries) {
    const color = TYPE_COLORS[type] || '#6b7280';
    const frac = count / total;
    const dash = frac * circ;
    segments += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="9"
      stroke-dasharray="${dash.toFixed(2)} ${(circ-dash).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${CX} ${CY})"/>`;
    offset += dash;
    legend += `<div style="display:flex;align-items:center;gap:6px;font-size:var(--font-xs);">
      <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
      <span style="color:var(--color-text-secondary);">${esc(typeLabel(type))}</span>
      <span style="margin-left:auto;color:var(--color-text-muted);white-space:nowrap;">${count} <span style="color:var(--color-text-disabled);">(${Math.round(frac*100)}%)</span></span>
    </div>`;
  }

  return `
    <div class="card card-compact" style="display:flex;gap:var(--space-5);align-items:center;">
      <svg width="76" height="76" viewBox="0 0 76 76" style="flex-shrink:0;" aria-hidden="true">
        <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="9"/>
        ${segments}
      </svg>
      <div style="flex:1;display:flex;flex-direction:column;gap:var(--space-2);">
        <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-1);">${icons.pieChart(12)} Recording Types</div>
        ${legend}
      </div>
    </div>`;
}
