// Takus — Google Drive Tests
// Tests folder operations, small file ops, and settings sync via mocked gapi.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock GoogleAuth
vi.mock('../google-auth.js', () => ({
  GoogleAuth: {
    getInstance: vi.fn(() => ({
      ensureValidToken: vi.fn().mockResolvedValue('test-token'),
      loadAPI: vi.fn().mockResolvedValue(),
      accessToken: 'test-token',
    })),
  },
}));

import { GoogleDrive } from '../google-drive.js';

describe('GoogleDrive', () => {
  let drive;

  beforeEach(() => {
    drive = new GoogleDrive();
    // Mock the gapi.client.drive API
    window.gapi = {
      client: {
        drive: {
          files: {
            list: vi.fn(),
            create: vi.fn(),
            get: vi.fn(),
            update: vi.fn(),
          },
        },
      },
    };
  });

  it('instantiates with auth reference', () => {
    expect(drive.auth).toBeDefined();
  });

  describe('ensureFolder', () => {
    it('returns existing folder if found', async () => {
      window.gapi.client.drive.files.list.mockResolvedValue({
        result: { files: [{ id: 'folder-123', name: 'Takus' }] },
      });

      const folderId = await drive.ensureFolder('Takus');
      expect(folderId).toBe('folder-123');
    });

    it('creates folder if not found', async () => {
      window.gapi.client.drive.files.list.mockResolvedValue({
        result: { files: [] },
      });
      window.gapi.client.drive.files.create.mockResolvedValue({
        result: { id: 'new-folder-456' },
      });

      const folderId = await drive.ensureFolder('Takus');
      expect(folderId).toBe('new-folder-456');
      expect(window.gapi.client.drive.files.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({
            name: 'Takus',
            mimeType: 'application/vnd.google-apps.folder',
          }),
        })
      );
    });
  });

  describe('listFolderContents', () => {
    it('returns files in a folder', async () => {
      window.gapi.client.drive.files.list.mockResolvedValue({
        result: {
          files: [
            { id: 'f1', name: 'file1.json' },
            { id: 'f2', name: 'file2.json' },
          ],
        },
      });

      const files = await drive.listFolderContents('parent-id');
      expect(files).toHaveLength(2);
      expect(files[0].name).toBe('file1.json');
    });
  });

  describe('downloadFileContent', () => {
    it('returns text content from fetch', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"key":"value"}'),
      });

      const content = await drive.downloadFileContent('file-id');
      expect(content).toBe('{"key":"value"}');
    });

    it('throws on non-OK response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      await expect(drive.downloadFileContent('bad-id')).rejects.toThrow('File download failed');
    });
  });

  describe('downloadFileBlob', () => {
    it('returns Blob from fetch', async () => {
      const mockBlob = new Blob(['hello'], { type: 'text/plain' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      const blob = await drive.downloadFileBlob('file-id');
      expect(blob).toBe(mockBlob);
    });

    it('throws on non-OK response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      await expect(drive.downloadFileBlob('bad-id')).rejects.toThrow('File download failed');
    });
  });

  describe('deleteFile', () => {
    it('performs DELETE request', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
      });

      await drive.deleteFile('file-id');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/files/file-id'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('ignores 404 error during deletion', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(drive.deleteFile('missing-id')).resolves.not.toThrow();
    });

    it('throws on other non-OK response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });
      await expect(drive.deleteFile('bad-id')).rejects.toThrow('Google Drive file deletion failed');
    });
  });
});
