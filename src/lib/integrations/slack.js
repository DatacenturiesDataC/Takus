// Takus — Slack integration (Phase 3: Connect)
// Posts messages to a Slack channel via an Incoming Webhook URL.
// Slack Incoming Webhooks support CORS, so no proxy is needed.

import { isStepDone, getTaskTitle } from '../task-helpers.js';

/**
 * Post a message to a Slack Incoming Webhook.
 * @param {string} webhookUrl
 * @param {{ text: string, blocks?: object[] }} payload
 */
export async function postToSlack(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // Slack webhooks return plain text "ok" on success
  const body = await res.text();
  if (!res.ok || body !== 'ok') {
    throw new Error(`Slack error: ${body || res.status}`);
  }
}

/**
 * Build a Slack Block Kit payload from a Takus task.
 * @param {{ title:string, action:string, payload:object, contextTimestamp:string }} task
 * @param {{ title:string, driveLink:string }} recording
 * @returns {{ text: string, blocks: object[] }}
 */
export function buildSlackPayload(task, recording) {
  const p       = task.payload || {};
  const message = p.message || p.text || getTaskTitle(task);
  const recRef  = recording?.driveLink
    ? `<${recording.driveLink}|${recording.title || 'Recording'}>`
    : recording?.title || '';

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${getTaskTitle(task)}*\n${message}${task.objective ? `\n_→ ${task.objective}_` : ''}`,
      },
    },
  ];

  // Steps as a compact section
  if (task.steps?.length) {
    const stepLines = task.steps.map(s => {
      const text = typeof s === 'string' ? s : s.text;
      const done = typeof s === 'object' && s !== null && isStepDone(s);
      return `${done ? '✅' : '⬜'} ${text}`;
    }).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: stepLines },
    });
  }

  const contextParts = [];
  if (task.contextTimestamp) contextParts.push(`Timestamp: ${task.contextTimestamp}`);
  if (recRef) contextParts.push(`From: ${recRef}`);
  if (contextParts.length) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: contextParts.join('  ·  ') }],
    });
  }

  return { text: getTaskTitle(task), blocks };
}
