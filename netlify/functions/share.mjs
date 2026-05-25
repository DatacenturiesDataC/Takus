// Takus — Share Function (Phase 13b: BRIDGE)
//
// POST /api/share  — store a shared summary, return a short ID
// GET  /api/share?id=xxx — retrieve a stored summary
//
// Uses Netlify Blobs (free tier: 1 GB) for persistence.
// No secrets stored server-side; payload is the summary content only.

import { getStore } from "@netlify/blobs";
import crypto from "crypto";

/** Generate a cryptographically-secure 12-char hex ID. */
function shortId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

// ---------------------------------------------------------------------------
// SEC-5: Blob-backed rate limiting (persists across cold starts / instances)
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 20;                    // max shares per window per origin

/**
 * Check and update rate limits for a given origin using Netlify Blobs.
 * Returns true if the origin has exceeded the rate limit, false otherwise.
 * @param {string} origin
 * @param {import('@netlify/blobs').Store} rateLimitStore
 * @returns {Promise<boolean>}
 */
async function isRateLimited(origin, rateLimitStore) {
  const key = `share_rl_${(origin || '__unknown__').replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  const now = Date.now();
  let record = { count: 0, windowStart: now };

  const raw = await rateLimitStore.get(key);
  if (raw) {
    try {
      record = JSON.parse(raw);
    } catch {
      // Reset on corrupt data
    }
  }

  // If the window has expired, reset
  if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    record = { count: 0, windowStart: now };
  }

  record.count += 1;
  await rateLimitStore.set(key, JSON.stringify(record));
  return record.count > RATE_LIMIT_MAX;
}

// 30 days in milliseconds
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

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

    // Check expiration
    try {
      const parsed = JSON.parse(data);
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
        // Best-effort cleanup of expired entry
        await store.delete(id).catch(() => {});
        return new Response(JSON.stringify({ error: "Share has expired" }), {
          status: 410,
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch {
      // If parsing fails, serve the data as-is (legacy entries)
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
    // Only allow creation from our own site
    const origin = req.headers.get('origin');
    const siteUrl = process.env.URL || 'https://takus.netlify.app';
    if (origin && !origin.startsWith(siteUrl) && !origin.includes('localhost')) {
      return new Response('Forbidden', { status: 403 });
    }

    // Rate limit check
    const rateLimitStore = getStore("share_rate_limits");
    if (await isRateLimited(origin, rateLimitStore)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Max 20 shares per hour." }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "3600",
        },
      });
    }

    // Size guard — reject payloads larger than 500 KB
    const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
    if (contentLength > 512_000) {
      return new Response(JSON.stringify({ error: "Payload too large (max 500 KB)" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
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

    const { title, date, type, aiSummary } = body;
    if (!title || !aiSummary) {
      return new Response(JSON.stringify({ error: "title and aiSummary are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const id = shortId();
    const now = Date.now();
    const payload = JSON.stringify({
      title,
      date,
      type,
      aiSummary,
      createdAt: now,
      expiresAt: now + EXPIRY_MS,
    });
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
