// Takus — Workspace Management Function
//
// POST   /api/workspace          — Create a new workspace
// GET    /api/workspace?code=X   — Lookup workspace by invite code
// POST   /api/workspace/join     — Join a workspace via invite code
// GET    /api/workspace/me       — Get my workspace (member auth)
// PATCH  /api/workspace          — Update workspace settings (admin auth)
// POST   /api/workspace/invite   — Regenerate invite code (admin auth)
//
// Uses Netlify Blobs store 'workspaces' for persistence.

import { getStore } from "@netlify/blobs";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a random string of given length from the supplied alphabet.
 * @param {number} len
 * @param {string} [alphabet]
 * @returns {string}
 */
function randomChars(len, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') {
  let result = '';
  for (let i = 0; i < len; i++) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

/**
 * Generate a workspace ID in the form ws_XXXXXXXX.
 * @returns {string}
 */
function generateWorkspaceId() {
  return `ws_${randomChars(8)}`;
}

/**
 * Generate a 32-character token for admin or member auth.
 * @returns {string}
 */
function generateToken() {
  return randomChars(32, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
}

/**
 * Generate a human-readable invite code in WORD-NNNN format
 * (4 uppercase letters + hyphen + 4 digits).
 * @returns {string}
 */
function generateInviteCode() {
  const letters = randomChars(4, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const digits = randomChars(4, '0123456789');
  return `${letters}-${digits}`;
}

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
 * @returns {Response|null} A 403 Response if invalid, null if valid.
 */
function validateOrigin(req) {
  const origin = req.headers.get('origin');
  const siteUrl = process.env.URL || 'https://takus.netlify.app';
  if (origin && !origin.startsWith(siteUrl) && !origin.includes('localhost')) {
    return new Response('Forbidden', { status: 403 });
  }
  return null;
}

/**
 * Find a workspace by its invite code (scans all blobs).
 * @param {import('@netlify/blobs').Store} store
 * @param {string} code
 * @returns {Promise<object|null>}
 */
async function findByInviteCode(store, code) {
  const { blobs } = await store.list();
  for (const blob of blobs) {
    const raw = await store.get(blob.key);
    if (!raw) continue;
    try {
      const ws = JSON.parse(raw);
      if (ws.inviteCode === code) return ws;
    } catch {
      // skip corrupt entries
    }
  }
  return null;
}

/**
 * Strip sensitive fields before returning workspace data to non-admin callers.
 * @param {object} ws
 * @returns {object}
 */
function publicWorkspace(ws) {
  const { aiKey, adminToken, members, ...rest } = ws;
  return { ...rest, memberCount: members ? members.length : 0 };
}

// ─── Main Handler ───────────────────────────────────────────────────────────

export default async (req, _context) => {
  const store = getStore("workspaces");
  const url = new URL(req.url);
  const subpath = url.pathname.replace(/^\/api\/workspace\/?/, '');

  // ── POST /api/workspace/join ──────────────────────────────────────────
  if (req.method === 'POST' && subpath === 'join') {
    const originErr = validateOrigin(req);
    if (originErr) return originErr;

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const { inviteCode, memberName } = body;
    if (!inviteCode || !memberName) {
      return json({ error: 'inviteCode and memberName are required' }, 400);
    }

    const ws = await findByInviteCode(store, inviteCode);
    if (!ws) {
      return json({ error: 'Workspace not found for that invite code' }, 404);
    }

    // Check for duplicate member name
    if (ws.members.some(m => m.name === memberName)) {
      return json({ error: 'A member with that name already exists' }, 409);
    }

    const memberToken = generateToken();
    ws.members.push({ name: memberName, token: memberToken, joinedAt: Date.now() });
    await store.set(ws.id, JSON.stringify(ws));

    return json({
      id: ws.id,
      name: ws.name,
      memberToken,
      aiProvider: ws.aiProvider,
      inviteCode: ws.inviteCode,
    }, 200);
  }

  // ── POST /api/workspace/invite — Regenerate invite code (admin) ───────
  if (req.method === 'POST' && subpath === 'invite') {
    const originErr = validateOrigin(req);
    if (originErr) return originErr;

    const wsId = req.headers.get('x-workspace-id');
    const adminToken = req.headers.get('x-admin-token');
    if (!wsId || !adminToken) {
      return json({ error: 'x-workspace-id and x-admin-token headers required' }, 401);
    }

    const raw = await store.get(wsId);
    if (!raw) return json({ error: 'Workspace not found' }, 404);

    const ws = JSON.parse(raw);
    if (ws.adminToken !== adminToken) {
      return json({ error: 'Unauthorized' }, 403);
    }

    ws.inviteCode = generateInviteCode();
    await store.set(ws.id, JSON.stringify(ws));

    return json({ inviteCode: ws.inviteCode });
  }

  // ── GET /api/workspace/me — Get my workspace (member auth) ────────────
  if (req.method === 'GET' && subpath === 'me') {
    const wsId = req.headers.get('x-workspace-id');
    const memberToken = req.headers.get('x-member-token');
    if (!wsId || !memberToken) {
      return json({ error: 'x-workspace-id and x-member-token headers required' }, 401);
    }

    const raw = await store.get(wsId);
    if (!raw) return json({ error: 'Workspace not found' }, 404);

    const ws = JSON.parse(raw);
    const member = ws.members.find(m => m.token === memberToken);
    if (!member) {
      return json({ error: 'Invalid member token' }, 403);
    }

    return json({
      id: ws.id,
      name: ws.name,
      aiProvider: ws.aiProvider,
      inviteCode: ws.inviteCode,
      memberCount: ws.members.length,
      memberName: member.name,
      settings: ws.settings || {},
    });
  }

  // ── GET /api/workspace?code=XXXX — Lookup by invite code ──────────────
  if (req.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code) {
      return json({ error: 'code query parameter is required' }, 400);
    }

    const ws = await findByInviteCode(store, code);
    if (!ws) {
      return json({ error: 'Workspace not found' }, 404);
    }

    return json({
      id: ws.id,
      name: ws.name,
      aiProvider: ws.aiProvider,
      memberCount: ws.members.length,
    });
  }

  // ── PATCH /api/workspace — Update workspace (admin only) ──────────────
  if (req.method === 'PATCH') {
    const originErr = validateOrigin(req);
    if (originErr) return originErr;

    const wsId = req.headers.get('x-workspace-id');
    const adminToken = req.headers.get('x-admin-token');
    if (!wsId || !adminToken) {
      return json({ error: 'x-workspace-id and x-admin-token headers required' }, 401);
    }

    const raw = await store.get(wsId);
    if (!raw) return json({ error: 'Workspace not found' }, 404);

    const ws = JSON.parse(raw);
    if (ws.adminToken !== adminToken) {
      return json({ error: 'Unauthorized' }, 403);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    // Allowlist of updatable fields
    const allowedFields = ['name', 'aiProvider', 'aiKey'];
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        ws[field] = body[field];
      }
    }

    await store.set(ws.id, JSON.stringify(ws));

    return json(publicWorkspace(ws));
  }

  // ── POST /api/workspace — Create workspace ────────────────────────────
  if (req.method === 'POST') {
    const originErr = validateOrigin(req);
    if (originErr) return originErr;

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const { name, adminName, aiProvider, aiKey } = body;
    if (!name || !adminName || !aiProvider || !aiKey) {
      return json({ error: 'name, adminName, aiProvider, and aiKey are required' }, 400);
    }

    const id = generateWorkspaceId();
    const adminToken = generateToken();
    const inviteCode = generateInviteCode();

    const workspace = {
      id,
      name,
      createdAt: Date.now(),
      adminToken,
      inviteCode,
      aiProvider,
      aiKey,
      members: [{ name: adminName, token: adminToken, joinedAt: Date.now() }],
      settings: {},
    };

    await store.set(id, JSON.stringify(workspace));

    return json({ id, adminToken, inviteCode, name }, 201);
  }

  return new Response('Method not allowed', { status: 405 });
};

export const config = {
  path: ["/api/workspace", "/api/workspace/*"],
};
