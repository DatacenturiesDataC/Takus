// Takus — Feedback Function
//
// POST /api/feedback — receive and store user/system feedback
// GET  /api/feedback — (future) retrieve feedback for product team
//
// Uses Netlify Blobs for persistence. All payloads are validated and
// sanitized before storage. No user content is ever collected.

import { getStore } from "@netlify/blobs";

function feedbackId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `fb_${ts}_${rand}`;
}

const VALID_CATEGORIES = ['bug', 'feature_request', 'ux', 'performance', 'other'];
const MAX_PAYLOAD_SIZE = 100_000; // 100 KB

export default async (req) => {
  const store = getStore("feedback");

  if (req.method === "POST") {
    // Origin validation
    const origin = req.headers.get('origin');
    const siteUrl = process.env.URL || 'https://takus.netlify.app';
    if (origin && !origin.startsWith(siteUrl) && !origin.includes('localhost')) {
      return new Response('Forbidden', { status: 403 });
    }

    // Size guard
    const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_PAYLOAD_SIZE) {
      return new Response(JSON.stringify({ error: "Payload too large (max 100 KB)" }), {
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

    // Validate required fields
    const { category, description } = body;
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return new Response(JSON.stringify({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!description || typeof description !== 'string' || description.trim().length < 5) {
      return new Response(JSON.stringify({ error: "Description must be at least 5 characters" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Defense-in-depth: strip any fields that look like user content
    const sanitized = {
      category,
      description: description.trim().slice(0, 2000),
      timestamp: body.timestamp || new Date().toISOString(),
      device_context: _sanitizeDeviceContext(body.device_context),
      recent_errors: _sanitizeErrors(body.recent_errors),
    };

    if (body.contact_email && typeof body.contact_email === 'string') {
      sanitized.contact_email = body.contact_email.slice(0, 100);
    }

    const id = feedbackId();
    const payload = JSON.stringify({ id, ...sanitized, received_at: new Date().toISOString() });
    await store.set(id, payload);

    return new Response(JSON.stringify({ received: true, id }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

function _sanitizeDeviceContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  // Allowlist of safe fields
  return {
    app_version: String(ctx.app_version || '').slice(0, 20),
    browser: String(ctx.browser || '').slice(0, 50),
    os: String(ctx.os || '').slice(0, 50),
    screen: String(ctx.screen || '').slice(0, 20),
    language: String(ctx.language || '').slice(0, 10),
    connected_providers: Array.isArray(ctx.connected_providers) ? ctx.connected_providers.slice(0, 5).map(p => String(p).slice(0, 30)) : [],
    ai_provider: ctx.ai_provider ? String(ctx.ai_provider).slice(0, 20) : null,
    enabled_features: Array.isArray(ctx.enabled_features) ? ctx.enabled_features.slice(0, 10).map(f => String(f).slice(0, 30)) : [],
    storage_used_mb: typeof ctx.storage_used_mb === 'number' ? ctx.storage_used_mb : null,
    online: !!ctx.online,
  };
}

function _sanitizeErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 10).map(e => ({
    message: String(e?.message || '').slice(0, 500),
    timestamp: String(e?.timestamp || '').slice(0, 30),
  }));
}

export const config = {
  path: "/api/feedback",
};
