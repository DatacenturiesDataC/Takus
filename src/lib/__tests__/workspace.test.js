// Takus — Workspace Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../storage.js', () => ({
  getSetting: vi.fn(),
  saveSetting: vi.fn().mockResolvedValue(undefined),
}));

// Module-level imports; we re-import per suite to reset _cachedWorkspace
let createWorkspace, joinWorkspace, getWorkspace, initWorkspace,
    isWorkspaceMember, getAIConfig, leaveWorkspace, updateWorkspace,
    regenerateInvite, getWorkspaceCached;

const { getSetting, saveSetting } = await import('../storage.js');

/** Helper: build a mock Response */
function mockRes(body, ok = true) {
  return {
    ok,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

async function loadModule() {
  vi.resetModules();
  // Re-apply the mock after resetModules
  vi.mock('../storage.js', () => ({
    getSetting: vi.fn(),
    saveSetting: vi.fn().mockResolvedValue(undefined),
  }));
  const mod = await import('../workspace.js');
  createWorkspace = mod.createWorkspace;
  joinWorkspace = mod.joinWorkspace;
  getWorkspace = mod.getWorkspace;
  initWorkspace = mod.initWorkspace;
  isWorkspaceMember = mod.isWorkspaceMember;
  getAIConfig = mod.getAIConfig;
  leaveWorkspace = mod.leaveWorkspace;
  updateWorkspace = mod.updateWorkspace;
  regenerateInvite = mod.regenerateInvite;
  getWorkspaceCached = mod.getWorkspaceCached;
  // Re-grab mocks from the fresh module scope
  const storage = await import('../storage.js');
  return storage;
}

describe('workspace', () => {
  let storage;

  beforeEach(async () => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn();
    storage = await loadModule();
  });

  // ── createWorkspace ──────────────────────────────────────────────
  describe('createWorkspace', () => {
    it('sends POST and stores workspace config locally', async () => {
      const serverData = {
        id: 'ws-1',
        name: 'Acme',
        adminToken: 'tok-admin',
        inviteCode: 'INV-123',
      };
      globalThis.fetch.mockResolvedValue(mockRes(serverData));

      const result = await createWorkspace('Acme', 'Alice', 'gemini', 'key-123');

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspace', expect.objectContaining({
        method: 'POST',
      }));
      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
      expect(body).toEqual({ name: 'Acme', adminName: 'Alice', aiProvider: 'gemini', aiKey: 'key-123' });

      // Verify local save — aiKey must NOT be persisted
      expect(storage.saveSetting).toHaveBeenCalledWith('workspace', expect.objectContaining({
        id: 'ws-1',
        name: 'Acme',
        adminToken: 'tok-admin',
        aiProvider: 'gemini',
      }));
      const saved = storage.saveSetting.mock.calls[0][1];
      expect(saved).not.toHaveProperty('aiKey');

      expect(result).toEqual(serverData);
    });

    it('throws on server error', async () => {
      globalThis.fetch.mockResolvedValue(mockRes('Conflict', false));
      await expect(createWorkspace('X', 'Y', 'openai', 'k')).rejects.toThrow('Conflict');
    });
  });

  // ── joinWorkspace ────────────────────────────────────────────────
  describe('joinWorkspace', () => {
    it('sends POST with invite code and stores member config', async () => {
      const serverData = {
        id: 'ws-2',
        name: 'Beta',
        memberToken: 'tok-member',
        aiProvider: 'openai',
        inviteCode: 'INV-456',
      };
      globalThis.fetch.mockResolvedValue(mockRes(serverData));

      const result = await joinWorkspace('INV-456', 'Bob');

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspace/join', expect.objectContaining({
        method: 'POST',
      }));
      expect(storage.saveSetting).toHaveBeenCalledWith('workspace', expect.objectContaining({
        id: 'ws-2',
        memberToken: 'tok-member',
        adminToken: null,
      }));
      expect(result).toEqual(serverData);
    });

    it('throws on invalid invite code', async () => {
      globalThis.fetch.mockResolvedValue(mockRes('Invalid invite code', false));
      await expect(joinWorkspace('BAD', 'Bob')).rejects.toThrow('Invalid invite code');
    });
  });

  // ── getWorkspace ─────────────────────────────────────────────────
  describe('getWorkspace', () => {
    it('returns workspace from storage', async () => {
      const ws = { id: 'ws-1', name: 'Test' };
      storage.getSetting.mockResolvedValue(ws);

      const result = await getWorkspace();
      expect(result).toEqual(ws);
      expect(storage.getSetting).toHaveBeenCalledWith('workspace');
    });

    it('returns null when storage throws', async () => {
      storage.getSetting.mockRejectedValue(new Error('not found'));
      const result = await getWorkspace();
      expect(result).toBeNull();
    });
  });

  // ── initWorkspace / isWorkspaceMember / getWorkspaceCached ──────
  describe('initWorkspace', () => {
    it('populates cache and isWorkspaceMember returns true', async () => {
      const ws = { id: 'ws-1', name: 'Cached', memberToken: 'tok' };
      storage.getSetting.mockResolvedValue(ws);

      const result = await initWorkspace();
      expect(result).toEqual(ws);
      expect(isWorkspaceMember()).toBe(true);
      expect(getWorkspaceCached()).toEqual(ws);
    });

    it('isWorkspaceMember returns false when no workspace', async () => {
      storage.getSetting.mockRejectedValue(new Error('nope'));

      await initWorkspace();
      expect(isWorkspaceMember()).toBe(false);
      expect(getWorkspaceCached()).toBeNull();
    });
  });

  // ── getAIConfig ──────────────────────────────────────────────────
  describe('getAIConfig', () => {
    it('returns proxy config when in a workspace', async () => {
      const ws = { id: 'ws-1', memberToken: 'tok', aiProvider: 'openai' };
      storage.getSetting.mockResolvedValue(ws);
      await initWorkspace();

      const config = getAIConfig();
      expect(config).toEqual({
        provider: 'openai',
        apiKey: null,
        useProxy: true,
        proxyUrl: '/api/ai-proxy',
        workspaceId: 'ws-1',
        memberToken: 'tok',
      });
    });

    it('defaults provider to gemini when aiProvider is missing', async () => {
      const ws = { id: 'ws-1', memberToken: 'tok' };
      storage.getSetting.mockResolvedValue(ws);
      await initWorkspace();

      const config = getAIConfig();
      expect(config.provider).toBe('gemini');
    });

    it('returns null when not in a workspace', async () => {
      storage.getSetting.mockRejectedValue(new Error('nope'));
      await initWorkspace();

      expect(getAIConfig()).toBeNull();
    });

    it('returns null when workspace has no memberToken', async () => {
      const ws = { id: 'ws-1' };
      storage.getSetting.mockResolvedValue(ws);
      await initWorkspace();

      expect(getAIConfig()).toBeNull();
    });
  });

  // ── leaveWorkspace ───────────────────────────────────────────────
  describe('leaveWorkspace', () => {
    it('clears cache and storage', async () => {
      const ws = { id: 'ws-1', memberToken: 'tok' };
      storage.getSetting.mockResolvedValue(ws);
      await initWorkspace();
      expect(isWorkspaceMember()).toBe(true);

      await leaveWorkspace();
      expect(isWorkspaceMember()).toBe(false);
      expect(getWorkspaceCached()).toBeNull();
      expect(storage.saveSetting).toHaveBeenCalledWith('workspace', null);
    });

    it('does not throw if saveSetting fails', async () => {
      storage.getSetting.mockResolvedValue({ id: 'ws-1', memberToken: 'tok' });
      await initWorkspace();
      storage.saveSetting.mockRejectedValueOnce(new Error('fail'));

      await expect(leaveWorkspace()).resolves.toBeUndefined();
    });
  });

  // ── updateWorkspace ──────────────────────────────────────────────
  describe('updateWorkspace', () => {
    it('sends PATCH with admin headers and updates cache', async () => {
      const ws = { id: 'ws-1', name: 'Old', adminToken: 'adm', memberToken: 'tok', aiProvider: 'gemini' };
      storage.getSetting.mockResolvedValue(ws);
      await initWorkspace();

      globalThis.fetch.mockResolvedValue(mockRes({ name: 'New', aiProvider: 'openai' }));

      const result = await updateWorkspace({ name: 'New' });

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspace', expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'x-workspace-id': 'ws-1',
          'x-admin-token': 'adm',
        }),
      }));
      expect(result.name).toBe('New');
      // Cache should be updated
      expect(getWorkspaceCached().name).toBe('New');
    });

    it('throws when not admin', async () => {
      const ws = { id: 'ws-1', memberToken: 'tok', adminToken: null };
      storage.getSetting.mockResolvedValue(ws);
      await initWorkspace();

      await expect(updateWorkspace({ name: 'X' })).rejects.toThrow('Admin access required');
    });

    it('throws on server error', async () => {
      const ws = { id: 'ws-1', adminToken: 'adm', memberToken: 'tok' };
      storage.getSetting.mockResolvedValue(ws);
      await initWorkspace();

      globalThis.fetch.mockResolvedValue(mockRes('Forbidden', false));
      await expect(updateWorkspace({ name: 'X' })).rejects.toThrow('Forbidden');
    });
  });

  // ── regenerateInvite ─────────────────────────────────────────────
  describe('regenerateInvite', () => {
    it('sends POST and updates cached invite code', async () => {
      const ws = { id: 'ws-1', adminToken: 'adm', memberToken: 'tok', inviteCode: 'OLD' };
      storage.getSetting.mockResolvedValue(ws);
      await initWorkspace();

      globalThis.fetch.mockResolvedValue(mockRes({ inviteCode: 'NEW-CODE' }));

      const result = await regenerateInvite();

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspace/invite', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-workspace-id': 'ws-1',
          'x-admin-token': 'adm',
        }),
      }));
      expect(result.inviteCode).toBe('NEW-CODE');
      expect(getWorkspaceCached().inviteCode).toBe('NEW-CODE');
    });

    it('throws when not admin', async () => {
      const ws = { id: 'ws-1', memberToken: 'tok', adminToken: null };
      storage.getSetting.mockResolvedValue(ws);
      await initWorkspace();

      await expect(regenerateInvite()).rejects.toThrow('Admin access required');
    });

    it('throws on server error', async () => {
      const ws = { id: 'ws-1', adminToken: 'adm', memberToken: 'tok' };
      storage.getSetting.mockResolvedValue(ws);
      await initWorkspace();

      globalThis.fetch.mockResolvedValue(mockRes('Server Error', false));
      await expect(regenerateInvite()).rejects.toThrow('Server Error');
    });
  });
});
