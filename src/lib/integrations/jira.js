// Takus — Jira Integration (Phase 13c: BRIDGE)
// Browser-side client that talks to /api/jira Netlify Function proxy.
// Credentials are stored in the Identity Vault and sent per-request.

import { loadCredential, saveCredential } from '../identity-vault.js';
import { esc } from '../utils.js';

const CRED_KEYS = { host: 'jira_host', email: 'jira_email', token: 'jira_token', project: 'jira_project' };

export async function getJiraConfig() {
  const [host, email, token, project] = await Promise.all([
    loadCredential(CRED_KEYS.host),
    loadCredential(CRED_KEYS.email),
    loadCredential(CRED_KEYS.token),
    loadCredential(CRED_KEYS.project),
  ]);
  return { host, email, token, project, configured: !!(host && email && token) };
}

export async function saveJiraConfig({ host, email, token, project }) {
  await Promise.all([
    saveCredential(CRED_KEYS.host, host),
    saveCredential(CRED_KEYS.email, email),
    saveCredential(CRED_KEYS.token, token),
    saveCredential(CRED_KEYS.project, project || ''),
  ]);
}

export async function clearJiraConfig() {
  await Promise.all(Object.values(CRED_KEYS).map(k => saveCredential(k, null)));
}

export async function verifyJiraConnection(config) {
  const res = await fetch('/api/jira', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host: config.host, email: config.email, token: config.token, dryRun: true }),
  });
  return res.json();
}

export async function createJiraIssue(config, issue) {
  const res = await fetch('/api/jira', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: config.host,
      email: config.email,
      token: config.token,
      project: config.project || issue.project,
      summary: issue.summary,
      description: issue.description,
      issueType: issue.issueType || 'Task',
    }),
  });
  return res.json();
}

export function buildJiraIssuePayload(task, recording) {
  const title = recording.title || 'Untitled Recording';
  const summary = task.payload || task.action || task.note || 'Takus Task';
  const lines = [
    `*Source:* ${esc(title)}`,
    `*Date:* ${new Date(recording.date).toLocaleDateString()}`,
    `*Type:* ${recording.type || 'recording'}`,
  ];
  if (task.contextTimestamp) {
    lines.push(`*Timestamp:* ~${Math.round(task.contextTimestamp)}s`);
  }
  if (recording.aiSummary) {
    lines.push('', '*AI Summary (excerpt):*', recording.aiSummary.slice(0, 500));
  }
  return { summary, description: lines.join('\n'), issueType: 'Task' };
}
