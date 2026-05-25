// Takus — Jira Proxy Function (Phase 13c: BRIDGE)
//
// POST /api/jira — proxy a request to Jira Cloud REST API (CORS-blocked)
//
// Credentials are sent per-request from the browser's Identity Vault.
// Nothing is stored server-side.

export default async (req) => {
  // Block cross-origin abuse — only allow requests from our own site
  const origin = req.headers.get('origin');
  const siteUrl = process.env.URL || 'https://takus.netlify.app';
  if (origin && !origin.startsWith(siteUrl) && !origin.includes('localhost')) {
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': siteUrl, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { host, email, token, project, summary, description, issueType, dryRun } = body;

  if (!host || !email || !token) {
    return new Response(JSON.stringify({ error: "host, email, and token are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Sanitise host: strip protocol and trailing slash
  const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const baseUrl = `https://${cleanHost}/rest/api/3`;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  // Dry-run: verify connection by fetching the current user
  if (dryRun) {
    try {
      const res = await fetch(`${baseUrl}/myself`, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return new Response(JSON.stringify({ error: `Jira auth failed (${res.status})`, detail: text }), {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      const user = await res.json();
      return new Response(JSON.stringify({ ok: true, displayName: user.displayName }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Create issue
  if (!project || !summary) {
    return new Response(JSON.stringify({ error: "project and summary are required for issue creation" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const issueBody = {
    fields: {
      project: { key: project },
      summary,
      description: _textToAdf(description || summary),
      issuetype: { name: issueType || "Task" },
    },
  };

  try {
    const res = await fetch(`${baseUrl}/issue`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(issueBody),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Jira error (${res.status})`, detail: data }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      key: data.key,
      url: `https://${cleanHost}/browse/${data.key}`,
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};

/**
 * Convert plain text (with optional *bold* wiki markup) to Jira ADF.
 * Splits on newlines into paragraphs and converts *text* into strong marks.
 */
function _textToAdf(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const content = lines.map(line => {
    // Convert *bold* wiki markup to ADF inline marks
    const parts = [];
    const regex = /\*([^*]+)\*/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', text: line.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'text', text: match[1], marks: [{ type: 'strong' }] });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < line.length) {
      parts.push({ type: 'text', text: line.slice(lastIndex) });
    }
    if (parts.length === 0) {
      parts.push({ type: 'text', text: line });
    }
    return { type: 'paragraph', content: parts };
  });
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

export const config = {
  path: "/api/jira",
};
