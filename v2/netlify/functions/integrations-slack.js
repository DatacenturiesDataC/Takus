/**
 * POST /api/integrations/slack
 *
 * Post an update recap message to a Slack channel.
 *
 * Request body:
 * { "channelId": string, "message": string, "clipUrl": string | null }
 *
 * Env vars required:
 *   SLACK_BOT_TOKEN    // xoxb-... (stored server-side, never sent to browser)
 */

export default async function handler(req) {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { channelId, message, clipUrl } = await req.json();

    if (!channelId || !message) {
      return Response.json({ error: 'channelId and message are required.' }, { status: 400 });
    }

    // ── Phase 6: implement Slack Web API call here ───────────────────────────
    // const res = await fetch('https://slack.com/api/chat.postMessage', {
    //   method: 'POST',
    //   headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ channel: channelId, text: message }),
    // });

    return Response.json({ stub: true, message: 'Slack integration — Phase 6.' });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export const config = {
  path: '/api/integrations/slack',
};
