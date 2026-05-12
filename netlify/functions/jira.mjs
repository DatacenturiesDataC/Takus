// Takus — Jira Proxy Function (Phase 13c: BRIDGE)
//
// POST /api/jira — proxy a request to Jira Cloud REST API (CORS-blocked)
//
// Credentials are sent per-request from the browser's Identity Vault.
// Nothing is stored server-side.

export default async (req) => {
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
      description: {
        type: "doc",
        version: 1,
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: description || summary }],
        }],
      },
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

export const config = {
  path: "/api/jira",
};
