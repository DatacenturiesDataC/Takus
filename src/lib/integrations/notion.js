// Takus — Notion Integration (Phase 13d: BRIDGE)
// Browser-side client that talks to /api/notion Netlify Function proxy.
// Credentials stored in Identity Vault, sent per-request.

import { loadCredential, saveCredential } from '../identity-vault.js';
import { isStepDone, getTaskTitle } from '../task-helpers.js';

const CRED_KEYS = { apiKey: 'notion_apikey', databaseId: 'notion_dbid' };

export async function getNotionConfig() {
  const [apiKey, databaseId] = await Promise.all([
    loadCredential(CRED_KEYS.apiKey),
    loadCredential(CRED_KEYS.databaseId),
  ]);
  return { apiKey, databaseId, configured: !!apiKey };
}

export async function saveNotionConfig({ apiKey, databaseId }) {
  await Promise.all([
    saveCredential(CRED_KEYS.apiKey, apiKey),
    saveCredential(CRED_KEYS.databaseId, databaseId || ''),
  ]);
}

export async function clearNotionConfig() {
  await Promise.all(Object.values(CRED_KEYS).map(k => saveCredential(k, null)));
}

export async function verifyNotionConnection(config) {
  const res = await fetch('/api/notion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: config.apiKey, action: 'verify' }),
  });
  return res.json();
}

export async function listNotionDatabases(apiKey) {
  const res = await fetch('/api/notion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, action: 'listDatabases' }),
  });
  return res.json();
}

export async function createNotionPage(config, { title, content }) {
  const res = await fetch('/api/notion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: config.apiKey,
      action: 'createPage',
      databaseId: config.databaseId,
      title,
      content,
    }),
  });
  return res.json();
}

export function buildNotionPayload(task, entry) {
  const title = getTaskTitle(task, task.action || 'Takus Task');
  const p = task.payload || {};
  const lines = [
    `# ${entry.title || 'Untitled Recording'}`,
    '',
    `**Date:** ${new Date(entry.date).toLocaleDateString()}`,
    `**Type:** ${entry.type || 'entry'}`,
  ];
  if (task.contextTimestamp) {
    lines.push(`**Timestamp:** ~${Math.round(task.contextTimestamp)}s`);
  }
  // Decision-specific fields
  if (p.decision) lines.push('', `## Decision`, p.decision);
  if (p.owner)    lines.push(`**Owner:** ${p.owner}`);
  if (p.rationale) lines.push(`**Rationale:** ${p.rationale}`);
  if (task.objective) lines.push('', `**Objective:** ${task.objective}`);
  if (task.steps?.length) {
    lines.push('', '## Steps');
    for (const step of task.steps) {
      const text = typeof step === 'string' ? step : step.text;
      const done = isStepDone(step);
      lines.push(`- [${done ? 'x' : ' '}] ${text}`);
    }
  }
  if (entry.driveLink) lines.push('', `**Recording:** ${entry.driveLink}`);
  if (entry.aiSummary) {
    lines.push('', '## AI Summary', entry.aiSummary.slice(0, 1500));
  }
  return { title, content: lines.join('\n') };
}
