
// Creates issues via the Linear GraphQL API.
// Linear's API supports CORS for browser requests.

import { isStepDone, getTaskTitle } from '../task-helpers.js';

const LINEAR_API = 'https://api.linear.app/graphql';

async function _query(apiKey, query, variables = {}) {
  const res = await fetch(LINEAR_API, {
    method:  'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('Linear API key is invalid. Check your key in Connect settings.');
    throw new Error(`Linear API error: ${res.status}`);
  }
  const data = await res.json();
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return data.data;
}

/**
 * Verify the API key and return the authenticated user's name.
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
export async function verifyLinearKey(apiKey) {
  const data = await _query(apiKey, `{ viewer { id name email } }`);
  return data?.viewer?.name || data?.viewer?.email || 'Unknown';
}

/**
 * Create a Linear issue.
 * @param {string} apiKey
 * @param {string} teamId   Linear team UUID
 * @param {{ title:string, description:string, priority?:number }} issue
 *   priority: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
 * @returns {Promise<{ url:string, identifier:string }>}
 */
export async function createLinearIssue(apiKey, teamId, issue) {
  const data = await _query(
    apiKey,
    `mutation CreateIssue($input: IssueCreateInput!) {
       issueCreate(input: $input) {
         success
         issue { id identifier url }
       }
     }`,
    { input: { teamId, title: issue.title, description: issue.description, priority: issue.priority ?? 0 } },
  );

  const created = data?.issueCreate?.issue;
  if (!created) throw new Error('Linear issue creation returned no issue.');
  return { url: created.url, identifier: created.identifier };
}

/**
 * Build a Linear issue from a Takus task.
 * @param {{ title:string, action:string, payload:object, contextTimestamp:string }} task
 * @param {{ title:string, driveLink:string }} entry
 * @returns {{ title:string, description:string, priority:number }}
 */
export function buildLinearIssuePayload(task, entry) {
  const p     = task.payload || {};
  const lines = [];

  if (p.steps)     lines.push('**Steps to Reproduce**', p.steps, '');
  if (p.expected)  lines.push(`**Expected:** ${p.expected}`);
  if (p.actual)    lines.push(`**Actual:** ${p.actual}`);
  if (p.error_log) lines.push('', '**Console Error**', '```', p.error_log, '```');
  if (p.decision)  lines.push(`**Decision:** ${p.decision}`);
  if (p.owner)     lines.push(`**Owner:** ${p.owner}`);

  if (task.objective) lines.push('', `**Objective:** ${task.objective}`);
  if (task.steps?.length) {
    lines.push('', '**Steps**');
    for (const step of task.steps) {
      const text = typeof step === 'string' ? step : step.text;
      const done = isStepDone(step);
      lines.push(`- [${done ? 'x' : ' '}] ${text}`);
    }
  }

  const refs = [];
  if (entry?.driveLink) refs.push(`[Source](${entry.driveLink})`);
  if (task.contextTimestamp) refs.push(`Timestamp: ${task.contextTimestamp}`);
  if (refs.length) lines.push('', '---', refs.join('  ·  '));

  const isBug      = task.action === 'CREATE_BUG_REPORT';
  const isUrgent   = p.priority === 'high';

  return {
    title:       getTaskTitle(task),
    description: lines.join('\n'),
    priority:    isBug && isUrgent ? 1 : isBug ? 2 : 0,
  };
}
