// Takus — AI Proxy Function
//
// POST /api/ai-proxy/transcribe — Proxy audio transcription requests
// POST /api/ai-proxy/chat       — Proxy chat completion requests
// POST /api/ai-proxy/embed      — Proxy embedding requests
//
// Authenticates via workspace membership, loads the workspace's API key
// from Netlify Blobs, and forwards the request to the appropriate AI
// provider (OpenAI or Gemini). Members never see the raw API key.
//
// Rate-limited to 100 requests per hour per workspace.

import { getStore } from "@netlify/blobs";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_REQUESTS_PER_HOUR = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_TRANSCRIBE_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

const OPENAI_BASE = "https://api.openai.com/v1";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Return a JSON Response with standard headers.
 * @param {object} body
 * @param {number} status
 * @returns {Response}
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Validate request origin — only allow our own site and localhost.
 * @param {Request} req
 * @returns {Response|null}
 */
function validateOrigin(req) {
  const origin = req.headers.get("origin");
  const siteUrl = process.env.URL || "https://takus.netlify.app";
  if (origin && !origin.startsWith(siteUrl) && !origin.includes("localhost")) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

/**
 * Verify workspace membership and return the workspace data.
 * @param {Request} req
 * @param {import('@netlify/blobs').Store} store
 * @returns {Promise<{ws: object, error: Response|null}>}
 */
async function authenticateMember(req, store) {
  const wsId = req.headers.get("x-workspace-id");
  const memberToken = req.headers.get("x-member-token");

  if (!wsId || !memberToken) {
    return { ws: null, error: json({ error: "x-workspace-id and x-member-token headers required" }, 401) };
  }

  const raw = await store.get(wsId);
  if (!raw) {
    return { ws: null, error: json({ error: "Workspace not found" }, 404) };
  }

  const ws = JSON.parse(raw);
  const member = ws.members.find((m) => m.token === memberToken);
  if (!member) {
    return { ws: null, error: json({ error: "Invalid member token" }, 403) };
  }

  return { ws, error: null };
}

/**
 * Check and update rate limits for a workspace.
 * Returns a 429 Response if the limit is exceeded, null otherwise.
 * @param {string} wsId
 * @param {import('@netlify/blobs').Store} rateLimitStore
 * @returns {Promise<Response|null>}
 */
async function checkRateLimit(wsId, rateLimitStore) {
  const now = Date.now();
  const key = `rl_${wsId}`;
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

  if (record.count > MAX_REQUESTS_PER_HOUR) {
    // Still persist so we don't reset on the next request
    await rateLimitStore.set(key, JSON.stringify(record));
    return json(
      {
        error: "Rate limit exceeded",
        retryAfter: Math.ceil((record.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000),
      },
      429,
    );
  }

  await rateLimitStore.set(key, JSON.stringify(record));
  return null;
}

// ─── Provider Proxies ───────────────────────────────────────────────────────

/**
 * Proxy a chat completion request to OpenAI.
 * @param {object} body - The request body (messages, model, etc.)
 * @param {string} apiKey
 * @returns {Promise<Response>}
 */
async function openaiChat(body, apiKey) {
  const resp = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await resp.text();
  return new Response(data, {
    status: resp.status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Proxy a chat request to Gemini's generateContent endpoint.
 * Translates the OpenAI-style messages format to Gemini format.
 * @param {object} body - { messages, model, ... }
 * @param {string} apiKey
 * @returns {Promise<Response>}
 */
async function geminiChat(body, apiKey) {
  const model = body.model || "gemini-pro";
  const contents = (body.messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const resp = await fetch(
    `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents }),
    },
  );
  const data = await resp.text();
  return new Response(data, {
    status: resp.status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Proxy a transcription request to OpenAI Whisper.
 * @param {Request} req - The original request (FormData body)
 * @param {string} apiKey
 * @returns {Promise<Response>}
 */
async function openaiTranscribe(req, apiKey) {
  // Clone the FormData from the incoming request
  const formData = await req.formData();

  const resp = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // Let fetch set Content-Type with boundary for FormData
    },
    body: formData,
  });
  const data = await resp.text();
  return new Response(data, {
    status: resp.status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Proxy a transcription request to Gemini (using generateContent with inline audio).
 * Expects FormData with a 'file' field and optional 'prompt' field.
 * @param {Request} req
 * @param {string} apiKey
 * @returns {Promise<Response>}
 */
async function geminiTranscribe(req, apiKey) {
  const formData = await req.formData();
  const file = formData.get("file");
  const prompt = formData.get("prompt") || "Transcribe this audio accurately.";
  const model = formData.get("model") || "gemini-pro";

  if (!file) {
    return json({ error: "No audio file provided" }, 400);
  }

  // Read file as base64
  const arrayBuffer = await file.arrayBuffer();
  const base64Data = btoa(
    String.fromCharCode(...new Uint8Array(arrayBuffer)),
  );

  const mimeType = file.type || "audio/webm";

  const resp = await fetch(
    `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
      }),
    },
  );
  const data = await resp.text();
  return new Response(data, {
    status: resp.status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Proxy an embedding request to OpenAI.
 * @param {object} body - { input, model }
 * @param {string} apiKey
 * @returns {Promise<Response>}
 */
async function openaiEmbed(body, apiKey) {
  const resp = await fetch(`${OPENAI_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await resp.text();
  return new Response(data, {
    status: resp.status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Proxy an embedding request to Gemini.
 * @param {object} body - { input, model }
 * @param {string} apiKey
 * @returns {Promise<Response>}
 */
async function geminiEmbed(body, apiKey) {
  const model = body.model || "text-embedding-004";
  const input = Array.isArray(body.input) ? body.input : [body.input];

  // Gemini batchEmbedContents expects an array of requests
  const requests = input.map((text) => ({
    model: `models/${model}`,
    content: { parts: [{ text }] },
  }));

  const resp = await fetch(
    `${GEMINI_BASE}/models/${model}:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    },
  );
  const data = await resp.text();
  return new Response(data, {
    status: resp.status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Main Handler ───────────────────────────────────────────────────────────

export default async (req, _context) => {
  // Only POST is accepted for all AI proxy endpoints
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const originErr = validateOrigin(req);
  if (originErr) return originErr;

  const url = new URL(req.url);
  const subpath = url.pathname.replace(/^\/api\/ai-proxy\/?/, "");

  const validEndpoints = ["transcribe", "chat", "embed"];
  if (!validEndpoints.includes(subpath)) {
    return json({ error: `Unknown endpoint: ${subpath}` }, 404);
  }

  // Authenticate member
  const workspaceStore = getStore("workspaces");
  const { ws, error: authErr } = await authenticateMember(req, workspaceStore);
  if (authErr) return authErr;

  // Check rate limit
  const rateLimitStore = getStore("rate-limits");
  const rateLimitErr = await checkRateLimit(ws.id, rateLimitStore);
  if (rateLimitErr) return rateLimitErr;

  // Ensure workspace has an API key
  if (!ws.aiKey) {
    return json({ error: "Workspace has no AI API key configured" }, 400);
  }

  const provider = ws.aiProvider || "openai";

  try {
    // ── Transcribe ────────────────────────────────────────────────────────
    if (subpath === "transcribe") {
      // Validate file size via Content-Length header
      const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
      if (contentLength > MAX_TRANSCRIBE_FILE_SIZE) {
        return json({ error: "File too large. Maximum size is 100 MB." }, 400);
      }

      // Clone the request so we can inspect FormData without consuming the body
      const clonedReq = req.clone();
      let formData;
      try {
        formData = await clonedReq.formData();
      } catch {
        return json({ error: "Invalid form data" }, 400);
      }

      const file = formData.get("file");
      if (file && file.size > MAX_TRANSCRIBE_FILE_SIZE) {
        return json({ error: "File too large. Maximum size is 100 MB." }, 400);
      }
      if (file) {
        const mime = file.type || "";
        if (!mime.startsWith("audio/") && !mime.startsWith("video/")) {
          return json({ error: `Invalid file type '${mime}'. Only audio/* and video/* files are accepted.` }, 400);
        }
      }

      if (provider === "gemini") {
        return await geminiTranscribe(req, ws.aiKey);
      }
      // Default: OpenAI / Whisper
      return await openaiTranscribe(req, ws.aiKey);
    }

    // ── Chat ──────────────────────────────────────────────────────────────
    if (subpath === "chat") {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }

      if (provider === "gemini") {
        return await geminiChat(body, ws.aiKey);
      }
      return await openaiChat(body, ws.aiKey);
    }

    // ── Embed ─────────────────────────────────────────────────────────────
    if (subpath === "embed") {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }

      if (provider === "gemini") {
        return await geminiEmbed(body, ws.aiKey);
      }
      return await openaiEmbed(body, ws.aiKey);
    }
  } catch (err) {
    console.error(`[ai-proxy] ${subpath} error:`, err);
    return json(
      { error: "Upstream AI request failed", details: err.message },
      502,
    );
  }

  return json({ error: "Unknown error" }, 500);
};

export const config = {
  path: "/api/ai-proxy/*",
};
