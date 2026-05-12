// Takus — Notion Proxy Function (Phase 13d: BRIDGE)
//
// POST /api/notion — proxy a request to Notion API (CORS-blocked)
//
// Credentials sent per-request from browser's Identity Vault.
// Nothing stored server-side.

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

  const { apiKey, action, databaseId, parentId, title, content, properties } = body;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "apiKey is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };

  // Verify connection
  if (action === "verify") {
    try {
      const res = await fetch("https://api.notion.com/v1/users/me", { headers });
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Notion auth failed (${res.status})` }), {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      const user = await res.json();
      return new Response(JSON.stringify({ ok: true, name: user.name || user.bot?.owner?.user?.name || "Connected" }), {
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

  // List databases (for config selector)
  if (action === "listDatabases") {
    try {
      const res = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers,
        body: JSON.stringify({ filter: { value: "database", property: "object" }, page_size: 20 }),
      });
      const data = await res.json();
      const databases = (data.results || []).map(db => ({
        id: db.id,
        title: db.title?.map(t => t.plain_text).join("") || "Untitled",
      }));
      return new Response(JSON.stringify({ ok: true, databases }), {
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

  // Create page in a database
  if (action === "createPage") {
    if (!databaseId && !parentId) {
      return new Response(JSON.stringify({ error: "databaseId or parentId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build rich text blocks from markdown content (Notion limits to 100 children per request)
    const blocks = _markdownToBlocks(content || "").slice(0, 100);

    const pageBody = {
      parent: databaseId
        ? { database_id: databaseId }
        : { page_id: parentId },
      properties: properties || {
        title: { title: [{ text: { content: title || "Untitled" } }] },
      },
      children: blocks,
    };

    try {
      const res = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers,
        body: JSON.stringify(pageBody),
      });
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Notion error (${res.status})`, detail: data }), {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, url: data.url, id: data.id }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
};

/**
 * Convert simple markdown to Notion block array.
 * Handles paragraphs, headings, bullet lists. Keeps it lightweight.
 */
function _markdownToBlocks(md) {
  const blocks = [];
  const lines = md.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Heading
    const h3 = trimmed.match(/^###\s+(.+)/);
    if (h3) {
      blocks.push({ type: "heading_3", heading_3: { rich_text: [{ text: { content: h3[1] } }] } });
      continue;
    }
    const h2 = trimmed.match(/^##\s+(.+)/);
    if (h2) {
      blocks.push({ type: "heading_2", heading_2: { rich_text: [{ text: { content: h2[1] } }] } });
      continue;
    }
    const h1 = trimmed.match(/^#\s+(.+)/);
    if (h1) {
      blocks.push({ type: "heading_1", heading_1: { rich_text: [{ text: { content: h1[1] } }] } });
      continue;
    }

    // Bullet list item
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    if (bullet) {
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ text: { content: bullet[1] } }] },
      });
      continue;
    }

    // Paragraph (truncate to Notion's 2000-char limit per block)
    blocks.push({
      type: "paragraph",
      paragraph: { rich_text: [{ text: { content: trimmed.slice(0, 2000) } }] },
    });
  }

  return blocks;
}

export const config = {
  path: "/api/notion",
};
