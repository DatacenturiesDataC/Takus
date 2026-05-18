
// Browser-side client that talks to /api/jira Netlify Function proxy.
// Credentials are stored in the Identity Vault and sent per-request.

import { loadCredential, saveCredential } from '../identity-vault.js';
import { esc } from '../utils.js';
import { isStepDone, getTaskTitle } from '../task-helpers.js';

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

export function buildJiraIssuePayload(task, entry) {
  const title = entry.title || 'Untitled';
  const summary = getTaskTitle(task, task.action || 'Takus Task');
  const p = task.payload || {};
  const lines = [
    `*Source:* ${esc(title)}`,
    `*Date:* ${new Date(entry.date).toLocaleDateString()}`,
    `*Type:* ${entry.type || 'entry'}`,
  ];
  if (task.contextTimestamp) {
    lines.push(`*Timestamp:* ~${Math.round(task.contextTimestamp)}s`);
  }
  if (p.steps)     lines.push('', `*Steps to reproduce:*\n${p.steps}`);
  if (p.expected)  lines.push(`*Expected:* ${p.expected}`);
  if (p.actual)    lines.push(`*Actual:* ${p.actual}`);
  if (p.error_log) lines.push(`*Console error:*\n{code}${p.error_log}{code}`);
  if (task.objective) lines.push('', `*Objective:* ${task.objective}`);
  if (task.steps?.length) {
    lines.push('', '*Steps:*');
    for (const step of task.steps) {
      const text = typeof step === 'string' ? step : step.text;
      const done = isStepDone(step);
      lines.push(`${done ? '(/) ' : '(x) '}${text}`);
    }
  }
  if (entry.driveLink) lines.push('', `*Source:* ${entry.driveLink}`);
  if (entry.aiSummary) {
    lines.push('', '*AI Summary (excerpt):*', entry.aiSummary.slice(0, 500));
  }
  return { summary, description: lines.join('\n'), issueType: 'Task' };
}
