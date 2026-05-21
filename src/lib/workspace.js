// Takus — Workspace Management (Client-Side)
// Manages workspace membership, AI proxy routing, and local workspace state.
// Workspace config is stored in IDB settings under the 'workspace' key.

import { getSetting, saveSetting } from './storage.js';

const API_BASE = '/api';
const WS_KEY = 'workspace';

/**
 * Create a new workspace. The creator becomes admin.
 * @param {string} name - Workspace name
 * @param {string} adminName - Admin's display name
 * @param {string} aiProvider - 'openai' or 'gemini'
 * @param {string} aiKey - API key (sent to server, never stored locally)
 * @returns {Promise<{id: string, adminToken: string, inviteCode: string, name: string}>}
 */
export async function createWorkspace(name, adminName, aiProvider, aiKey) {
  const res = await fetch(`${API_BASE}/workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, adminName, aiProvider, aiKey }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  // Store workspace config locally (never store aiKey)
  await saveSetting(WS_KEY, {
    id: data.id,
    name: data.name,
    memberToken: data.adminToken, // admin is also a member
    adminToken: data.adminToken,
    aiProvider,
    inviteCode: data.inviteCode,
  });
  return data;
}

/**
 * Join an existing workspace with an invite code.
 * @param {string} inviteCode - The invite code to join with
 * @param {string} memberName - Display name for the new member
 * @returns {Promise<{id: string, name: string, memberToken: string, aiProvider: string, inviteCode: string}>}
 */
export async function joinWorkspace(inviteCode, memberName) {
  const res = await fetch(`${API_BASE}/workspace/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode, memberName }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  await saveSetting(WS_KEY, {
    id: data.id,
    name: data.name,
    memberToken: data.memberToken,
    adminToken: null,
    aiProvider: data.aiProvider,
    inviteCode: data.inviteCode,
  });
  return data;
}

/**
 * Look up a workspace by invite code (preview before joining).
 * @param {string} inviteCode - The invite code to look up
 * @returns {Promise<object|null>} Workspace preview data or null if not found
 */
export async function lookupWorkspace(inviteCode) {
  const res = await fetch(`${API_BASE}/workspace?code=${encodeURIComponent(inviteCode)}`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Get the current workspace from local storage.
 * Returns null if not in a workspace.
 * @returns {Promise<object|null>}
 */
export async function getWorkspace() {
  return getSetting(WS_KEY).catch(() => null);
}

/** @type {object|null} Synchronous workspace cache — use getWorkspaceCached() */
let _cachedWorkspace = null;

/** Synchronous check — uses cached value */
export function getWorkspaceCached() { return _cachedWorkspace; }

/**
 * Initialize workspace cache on app start.
 * Must be called during app initialization before any workspace checks.
 * @returns {Promise<object|null>} The cached workspace or null
 */
export async function initWorkspace() {
  _cachedWorkspace = await getWorkspace();
  return _cachedWorkspace;
}

/**
 * Check if user is in a workspace.
 * @returns {boolean}
 */
export function isWorkspaceMember() {
  return !!_cachedWorkspace;
}

/**
 * Check if user is workspace admin.
 * @returns {boolean}
 */
export function isWorkspaceAdmin() {
  return !!_cachedWorkspace?.adminToken;
}

/**
 * Get AI configuration — workspace takes precedence over personal.
 * Returns the workspace proxy config if in a workspace, otherwise null
 * so the caller falls back to personal settings.
 *
 * @returns {{ provider: string, apiKey: null, useProxy: boolean, proxyUrl: string, workspaceId: string, memberToken: string }|null}
 */
export function getAIConfig() {
  const ws = _cachedWorkspace;
  if (ws?.id && ws?.memberToken) {
    return {
      provider: ws.aiProvider || 'gemini',
      apiKey: null, // Never stored locally for workspace
      useProxy: true,
      proxyUrl: `${API_BASE}/ai-proxy`,
      workspaceId: ws.id,
      memberToken: ws.memberToken,
    };
  }
  // Fallback: personal keys from settings-store
  return null; // Caller should use personal settings
}

/**
 * Leave workspace — clear local data.
 * @returns {Promise<void>}
 */
export async function leaveWorkspace() {
  _cachedWorkspace = null;
  await saveSetting(WS_KEY, null).catch(() => {});
}

/**
 * Update workspace (admin only).
 * @param {object} updates - Fields to update (name, aiProvider, aiKey)
 * @returns {Promise<object>} Updated workspace data from server
 */
export async function updateWorkspace(updates) {
  const ws = _cachedWorkspace;
  if (!ws?.adminToken) throw new Error('Admin access required');
  const res = await fetch(`${API_BASE}/workspace`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-workspace-id': ws.id,
      'x-admin-token': ws.adminToken,
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  // Update local cache
  if (data.name) ws.name = data.name;
  if (data.aiProvider) ws.aiProvider = data.aiProvider;
  _cachedWorkspace = ws;
  await saveSetting(WS_KEY, ws);
  return data;
}

/**
 * Regenerate invite code (admin only).
 * @returns {Promise<{inviteCode: string}>} New invite code
 */
export async function regenerateInvite() {
  const ws = _cachedWorkspace;
  if (!ws?.adminToken) throw new Error('Admin access required');
  const res = await fetch(`${API_BASE}/workspace/invite`, {
    method: 'POST',
    headers: {
      'x-workspace-id': ws.id,
      'x-admin-token': ws.adminToken,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  ws.inviteCode = data.inviteCode;
  _cachedWorkspace = ws;
  await saveSetting(WS_KEY, ws);
  return data;
}
