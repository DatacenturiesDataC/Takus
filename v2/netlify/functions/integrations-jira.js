/**
 * POST /api/integrations/jira
 *
 * Create or comment on a Jira issue from an agent bug report.
 *
 * Request body:
 * { "action": "create" | "comment", "ticketId": string | null, "bugReport": object }
 *
 * Env vars required:
 *   JIRA_DOMAIN          // e.g. yourcompany.atlassian.net
 *   JIRA_USER_EMAIL
 *   JIRA_API_TOKEN
 *   JIRA_PROJECT_KEY     // e.g. PROJ
 */

export default async function handler(req) {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { action, ticketId, bugReport } = await req.json();

    if (!action || !bugReport) {
      return Response.json({ error: 'action and bugReport are required.' }, { status: 400 });
    }

    // ── Phase 6: implement Jira API calls here ───────────────────────────────
    // const auth = Buffer.from(`${process.env.JIRA_USER_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
    // const base = `https://${process.env.JIRA_DOMAIN}/rest/api/3`;
    // if (action === 'create') { ... POST /issue }
    // if (action === 'comment') { ... POST /issue/${ticketId}/comment }

    return Response.json({ stub: true, message: 'Jira integration — Phase 6.' });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export const config = {
  path: '/api/integrations/jira',
};
