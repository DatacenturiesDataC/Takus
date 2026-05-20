// Takus — Microsoft OneDrive Tests
// Tests folder operations, file ops, and settings sync via mocked fetch.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MicrosoftAuth
vi.mock('../microsoft-auth.js', () => ({
  MicrosoftAuth: {
    getInstance: vi.fn(() => ({
      ensureValidToken: vi.fn().mockResolvedValue('ms-test-token'),
    })),
  },
}));

import { MicrosoftOneDrive } from '../microsoft-onedrive.js';

describe('MicrosoftOneDrive', () => {
  let drive;

  beforeEach(() => {
    drive = new MicrosoftOneDrive();
    vi.restoreAllMocks();
  });

  it('instantiates with auth reference', () => {
    expect(drive.auth).toBeDefined();
  });

  describe('ensureFolder', () => {
    it('returns existing folder if found', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'od-folder-123', name: 'Takus' }),
      });

      const folderId = await drive.ensureFolder('Takus');
      expect(folderId).toBe('od-folder-123');
    });

    it('creates folder if not found (404)', async () => {
      // First call: 404 (not found), second call: create succeeds
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'od-new-folder' }),
        });

      const folderId = await drive.ensureFolder('Takus');
      expect(folderId).toBe('od-new-folder');
    });
  });

  describe('listFolderContents', () => {
    it('returns files in a folder', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          value: [
            { id: 'f1', name: 'file1.json' },
            { id: 'f2', name: 'file2.json' },
          ],
        }),
      });

      const files = await drive.listFolderContents('/Takus');
      expect(files).toHaveLength(2);
      expect(files[0].name).toBe('file1.json');
    });

    it('returns empty array on error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const files = await drive.listFolderContents('/nonexistent');
      expect(files).toEqual([]);
    });
  });

  describe('downloadFileContent', () => {
    it('returns raw text content', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"setting":"value"}'),
      });

      const content = await drive.downloadFileContent('/Takus/settings.json');
      expect(content).toBe('{"setting":"value"}');
    });

    it('throws on error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      await expect(drive.downloadFileContent('/nonexistent')).rejects.toThrow('OneDrive file download failed');
    });
  });

  describe('downloadFileBlob', () => {
    it('returns Blob from fetch', async () => {
      const mockBlob = new Blob(['hello'], { type: 'text/plain' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      const blob = await drive.downloadFileBlob('/Takus/entry.webm');
      expect(blob).toBe(mockBlob);
    });

    it('throws on error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      await expect(drive.downloadFileBlob('/nonexistent')).rejects.toThrow('OneDrive file download failed');
    });
  });

  describe('deleteFile', () => {
    it('performs DELETE request by path', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
      });

      await drive.deleteFile('Takus/entry.webm');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/me/drive/root:/Takus/entry.webm'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('performs DELETE request by ID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
      });

      await drive.deleteFile('item-id-123');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/me/drive/items/item-id-123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('ignores 404 error during deletion', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(drive.deleteFile('item-id-404')).resolves.not.toThrow();
    });

    it('throws on other non-OK response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });
      await expect(drive.deleteFile('item-id-500')).rejects.toThrow('OneDrive file deletion failed');
    });
  });
});
