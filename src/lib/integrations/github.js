// Takus — GitHub Issues integration (Phase 3: Connect)
// Creates issues via the GitHub REST API v3.
// Requires a Personal Access Token with the `repo` scope.
// GitHub API supports CORS for browser requests with Authorization header.

const GITHUB_API = 'https://api.github.com';

/**
 * Create a GitHub issue.
 * @param {string} token   PAT with repo scope
 * @param {string} owner   repo owner (user or org)
 * @param {string} repo    repo name
 * @param {{ title:string, body:string, labels?:string[] }} issue
 * @returns {Promise<{ url:string, number:number }>}
 */
export async function createGitHubIssue(token, owner, repo, issue) {
  const res = await fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/vnd.github.v3+json',
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        title:  issue.title,
        body:   issue.body,
        labels: issue.labels || [],
      }),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('GitHub token is invalid or expired. Check your PAT in Connect settings.');
    if (res.status === 404) throw new Error(`Repository ${owner}/${repo} not found or token lacks repo access.`);
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  return { url: data.html_url, number: data.number };
}

/**
 * Verify a PAT is valid and has repo access.
 * @param {string} token
 * @returns {Promise<string>}  GitHub login name
 */
export async function verifyGitHubToken(token) {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!res.ok) throw new Error('Invalid GitHub token.');
  const data = await res.json();
  return data.login;
}

/**
 * Build a GitHub issue body from a Takus bug-report task.
 * @param {{ title:string, payload:object, contextTimestamp:string }} task
 * @param {{ title:string, driveLink:string }} recording
 * @returns {{ title:string, body:string, labels:string[] }}
 */
export function buildGitHubIssuePayload(task, recording) {
  const p     = task.payload || {};
  const lines = ['## Bug Report', ''];

  if (p.steps)     lines.push('### Steps to Reproduce', p.steps, '');
  if (p.expected)  lines.push(`**Expected:** ${p.expected}`, '');
  if (p.actual)    lines.push(`**Actual:** ${p.actual}`, '');
  if (p.error_log) lines.push('### Console Error', '```', p.error_log, '```', '');

  const refs = [];
  if (recording?.driveLink) refs.push(`[Recording: ${recording.title || 'View'}](${recording.driveLink})`);
  if (task.contextTimestamp) refs.push(`Timestamp: \`${task.contextTimestamp}\``);
  if (refs.length) lines.push('---', ...refs);

  return { title: task.title, body: lines.join('\n'), labels: ['bug'] };
}
