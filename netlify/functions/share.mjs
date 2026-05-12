// Takus — Share Function (Phase 13b: BRIDGE)
//
// POST /api/share  — store a shared summary, return a short ID
// GET  /api/share?id=xxx — retrieve a stored summary
//
// Uses Netlify Blobs (free tier: 1 GB) for persistence.
// No secrets stored server-side; payload is the summary content only.

import { getStore } from "@netlify/blobs";

function shortId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export default async (req, context) => {
  const store = getStore("shares");

  // GET — retrieve a shared payload
  if (req.method === "GET") {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id || !/^[a-z0-9]{4,16}$/.test(id)) {
      return new Response(JSON.stringify({ error: "Invalid share ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await store.get(id);
    if (!data) {
      return new Response(JSON.stringify({ error: "Share not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // POST — create a new shared summary
  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { title, date, type, aiSummary } = body;
    if (!title || !aiSummary) {
      return new Response(JSON.stringify({ error: "title and aiSummary are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const id = shortId();
    const payload = JSON.stringify({ title, date, type, aiSummary, createdAt: Date.now() });
    await store.set(id, payload);

    return new Response(JSON.stringify({ id, url: `/api/share?id=${id}` }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = {
  path: "/api/share",
};
