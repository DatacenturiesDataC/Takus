// Takus — Archive Engine Tests
// Tests eligibility checks, content classification, and key frame timestamp generation.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkEligibility,
  classifyContent,
  ContentClass,
  ArchiveStatus,
  isEligibleForColdStorage,
  transitionToColdStorage,
  scanEligibleColdStorageEntries,
  restoreEntry
} from '../archive-engine.js';

const mockStore = {
  entries: new Map(),
  vaultSync: new Map(),
  mediaBlobs: new Map(),
};

vi.mock('../storage.js', () => ({
  getEntries: vi.fn(async () => Array.from(mockStore.entries.values())),
  saveEntry: vi.fn(async (entry) => {
    mockStore.entries.set(entry.id, entry);
    return entry;
  }),
  saveMediaBlob: vi.fn(async (id, blob) => {
    mockStore.mediaBlobs.set(id, blob);
  }),
  getVaultSync: vi.fn(async (id) => mockStore.vaultSync.get(id)),
  saveVaultSync: vi.fn(async (vs) => {
    mockStore.vaultSync.set(vs.id, vs);
    return vs;
  }),
  getAllVaultSync: vi.fn(async () => Array.from(mockStore.vaultSync.values())),
}));

const mockProvider = {
  id: 'google',
  storage: {
    ensureFolderPath: vi.fn(async () => 'folder-123'),
    listFolderContents: vi.fn(async () => [
      { id: 'vid-123', name: 'original.webm' },
      { id: 'meta-123', name: 'metadata.json' },
    ]),
    deleteFile: vi.fn(async () => {}),
    downloadFileBlob: vi.fn(async () => new Blob(['video-data'])),
    downloadFileContent: vi.fn(async () => JSON.stringify({ id: 'r1', archiveStatus: 'archived' })),
    uploadSmallFile: vi.fn(async () => {}),
    auth: {
      ensureValidToken: vi.fn(async () => 'mock-token'),
    },
  },
};

vi.mock('../cloud-provider.js', () => ({
  CloudProviderManager: {
    getInstance: vi.fn(() => ({
      getProvider: vi.fn(() => mockProvider),
    })),
  },
}));


describe('ArchiveStatus', () => {
  it('includes RESTORED status', () => {
    expect(ArchiveStatus.RESTORED).toBe('restored');
  });

  it('includes all expected statuses', () => {
    expect(Object.keys(ArchiveStatus)).toEqual(
      expect.arrayContaining(['ACTIVE', 'PENDING', 'ARCHIVED', 'COLD', 'RESTORED'])
    );
  });
});

describe('checkEligibility', () => {
  const NOW = Date.now();
  const daysAgo = (n) => NOW - n * 24 * 60 * 60 * 1000;

  it('eligible: old entry, cloud-synced, not pinned', () => {
    const entry = { id: 'r1', date: daysAgo(45) };
    const vs = { drivePackageUploaded: true, archiveStatus: 'active' };
    const result = checkEligibility(entry, vs);
    expect(result.eligible).toBe(true);
  });

  it('ineligible: already archived', () => {
    const entry = { id: 'r1', date: daysAgo(45) };
    const vs = { drivePackageUploaded: true, archiveStatus: ArchiveStatus.ARCHIVED };
    expect(checkEligibility(entry, vs).eligible).toBe(false);
    expect(checkEligibility(entry, vs).reason).toContain('Already archived');
  });

  it('ineligible: archive pending', () => {
    const entry = { id: 'r1', date: daysAgo(45) };
    const vs = { drivePackageUploaded: true, archiveStatus: ArchiveStatus.PENDING };
    expect(checkEligibility(entry, vs).eligible).toBe(false);
    expect(checkEligibility(entry, vs).reason).toContain('pending');
  });

  it('ineligible: cold storage', () => {
    const entry = { id: 'r1', date: daysAgo(200) };
    const vs = { drivePackageUploaded: true, archiveStatus: ArchiveStatus.COLD };
    expect(checkEligibility(entry, vs).eligible).toBe(false);
  });

  it('ineligible: pinned entry', () => {
    const entry = { id: 'r1', date: daysAgo(45), pinned: true };
    const vs = { drivePackageUploaded: true };
    expect(checkEligibility(entry, vs).eligible).toBe(false);
    expect(checkEligibility(entry, vs).reason).toContain('pinned');
  });

  it('ineligible: pinned via vault sync', () => {
    const entry = { id: 'r1', date: daysAgo(45) };
    const vs = { drivePackageUploaded: true, pinned: true };
    expect(checkEligibility(entry, vs).eligible).toBe(false);
  });

  it('ineligible: legal hold', () => {
    const entry = { id: 'r1', date: daysAgo(45), legalHold: true };
    const vs = { drivePackageUploaded: true };
    expect(checkEligibility(entry, vs).eligible).toBe(false);
    expect(checkEligibility(entry, vs).reason).toContain('legal hold');
  });

  it('ineligible: too recent (under 30 days)', () => {
    const entry = { id: 'r1', date: daysAgo(15) };
    const vs = { drivePackageUploaded: true };
    expect(checkEligibility(entry, vs).eligible).toBe(false);
    expect(checkEligibility(entry, vs).reason).toContain('15 days old');
  });

  it('ineligible: not synced to cloud', () => {
    const entry = { id: 'r1', date: daysAgo(45) };
    const vs = { drivePackageUploaded: false };
    expect(checkEligibility(entry, vs).eligible).toBe(false);
    expect(checkEligibility(entry, vs).reason).toContain('not yet synced');
  });

  it('ineligible: no vault sync at all', () => {
    const entry = { id: 'r1', date: daysAgo(45) };
    expect(checkEligibility(entry, null).eligible).toBe(false);
  });

  it('respects custom archiveAfterDays', () => {
    const entry = { id: 'r1', date: daysAgo(10) };
    const vs = { drivePackageUploaded: true };
    // Default 30 days — not eligible at 10 days
    expect(checkEligibility(entry, vs).eligible).toBe(false);
    // Custom 7 days — eligible at 10 days
    expect(checkEligibility(entry, vs, 7).eligible).toBe(true);
  });
});

describe('classifyContent', () => {
  it('meeting → transcript-centric', () => {
    expect(classifyContent({ type: 'meeting' })).toBe(ContentClass.TRANSCRIPT);
  });

  it('update → transcript-centric', () => {
    expect(classifyContent({ type: 'update' })).toBe(ContentClass.TRANSCRIPT);
  });

  it('presentation → slide-screen-share', () => {
    expect(classifyContent({ type: 'presentation' })).toBe(ContentClass.SLIDE);
  });

  it('long screen → slide-screen-share', () => {
    expect(classifyContent({ type: 'screen', duration: 1200 })).toBe(ContentClass.SLIDE);
  });

  it('short screen → dynamic-visual', () => {
    expect(classifyContent({ type: 'screen', duration: 120 })).toBe(ContentClass.DYNAMIC);
  });

  it('screen with no duration → dynamic-visual', () => {
    expect(classifyContent({ type: 'screen' })).toBe(ContentClass.DYNAMIC);
  });

  it('unknown type → slide-screen-share (default)', () => {
    expect(classifyContent({ type: 'unknown' })).toBe(ContentClass.SLIDE);
  });

  it('no type → dynamic-visual (defaults to screen)', () => {
    expect(classifyContent({})).toBe(ContentClass.DYNAMIC);
  });
});

describe('Cold Storage Lifecycle', () => {
  const NOW = Date.now();
  const daysAgo = (n) => NOW - n * 24 * 60 * 60 * 1000;

  beforeEach(() => {
    mockStore.entries.clear();
    mockStore.vaultSync.clear();
    mockStore.mediaBlobs.clear();
    vi.clearAllMocks();
  });

  describe('isEligibleForColdStorage', () => {
    it('eligible: status ARCHIVED, > 90 days ago, not pinned', () => {
      const entry = { id: 'r1', date: daysAgo(95), archivedAt: new Date(daysAgo(95)).toISOString() };
      const vs = { id: 'r1', archiveStatus: ArchiveStatus.ARCHIVED };
      expect(isEligibleForColdStorage(entry, vs).eligible).toBe(true);
    });

    it('ineligible: already COLD', () => {
      const entry = { id: 'r1', date: daysAgo(95) };
      const vs = { id: 'r1', archiveStatus: ArchiveStatus.COLD };
      expect(isEligibleForColdStorage(entry, vs).eligible).toBe(false);
      expect(isEligibleForColdStorage(entry, vs).reason).toContain('Already in cold storage');
    });

    it('ineligible: status is ACTIVE', () => {
      const entry = { id: 'r1', date: daysAgo(95) };
      const vs = { id: 'r1', archiveStatus: ArchiveStatus.ACTIVE };
      expect(isEligibleForColdStorage(entry, vs).eligible).toBe(false);
      expect(isEligibleForColdStorage(entry, vs).reason).toContain('not archived');
    });

    it('ineligible: age < 90 days', () => {
      const entry = { id: 'r1', date: daysAgo(45), archivedAt: new Date(daysAgo(45)).toISOString() };
      const vs = { id: 'r1', archiveStatus: ArchiveStatus.ARCHIVED };
      expect(isEligibleForColdStorage(entry, vs).eligible).toBe(false);
      expect(isEligibleForColdStorage(entry, vs).reason).toContain('45 days old');
    });

    it('ineligible: pinned locally', () => {
      const entry = { id: 'r1', date: daysAgo(95), pinned: true };
      const vs = { id: 'r1', archiveStatus: ArchiveStatus.ARCHIVED };
      expect(isEligibleForColdStorage(entry, vs).eligible).toBe(false);
      expect(isEligibleForColdStorage(entry, vs).reason).toContain('pinned');
    });

    it('ineligible: pinned in vaultSync', () => {
      const entry = { id: 'r1', date: daysAgo(95) };
      const vs = { id: 'r1', archiveStatus: ArchiveStatus.ARCHIVED, pinned: true };
      expect(isEligibleForColdStorage(entry, vs).eligible).toBe(false);
      expect(isEligibleForColdStorage(entry, vs).reason).toContain('pinned');
    });

    it('ineligible: under legal hold locally', () => {
      const entry = { id: 'r1', date: daysAgo(95), legalHold: true };
      const vs = { id: 'r1', archiveStatus: ArchiveStatus.ARCHIVED };
      expect(isEligibleForColdStorage(entry, vs).eligible).toBe(false);
      expect(isEligibleForColdStorage(entry, vs).reason).toContain('legal hold');
    });
  });

  describe('transitionToColdStorage', () => {
    it('performs cold storage transition by deleting the video and updating metadata', async () => {
      const entry = { id: 'r1', date: daysAgo(100), archivedAt: new Date(daysAgo(100)).toISOString() };
      const vs = { id: 'r1', archiveStatus: ArchiveStatus.ARCHIVED };
      mockStore.entries.set('r1', entry);
      mockStore.vaultSync.set('r1', vs);

      const res = await transitionToColdStorage(entry);
      expect(res.success).toBe(true);

      // Verify video was deleted via deleteFile
      expect(mockProvider.storage.deleteFile).toHaveBeenCalledWith('vid-123');

      // Verify entry updated to COLD locally
      const updatedEntry = mockStore.entries.get('r1');
      expect(updatedEntry.archiveStatus).toBe(ArchiveStatus.COLD);
      expect(updatedEntry.coldStorageAt).toBeDefined();
      expect(updatedEntry.archiveLog).toContainEqual(
        expect.objectContaining({ action: 'cold_storage_expired', deletedVideo: true })
      );

      // Verify vaultSync updated to COLD
      const updatedVS = mockStore.vaultSync.get('r1');
      expect(updatedVS.archiveStatus).toBe(ArchiveStatus.COLD);
    });
  });

  describe('restoreEntry', () => {
    it('performs partial restore from cold storage (no video, artefacts only)', async () => {
      const entry = { id: 'r1', date: daysAgo(100), archiveStatus: ArchiveStatus.COLD };
      const vs = { id: 'r1', archiveStatus: ArchiveStatus.COLD };
      mockStore.entries.set('r1', entry);
      mockStore.vaultSync.set('r1', vs);

      const res = await restoreEntry(entry);
      expect(res.success).toBe(true);
      expect(res.partial).toBe(true);
    });

    it('fails gracefully if no video is found in the cloud during restore', async () => {
      const entry = { id: 'r1', date: daysAgo(45), archiveStatus: ArchiveStatus.ARCHIVED };
      const vs = { id: 'r1', archiveStatus: ArchiveStatus.ARCHIVED };
      mockStore.entries.set('r1', entry);
      mockStore.vaultSync.set('r1', vs);

      // Stub search to find no video files
      mockProvider.storage.listFolderContents.mockResolvedValueOnce([
        { id: 'meta-123', name: 'metadata.json' },
      ]);

      const res = await restoreEntry(entry);
      expect(res.success).toBe(false);
      expect(res.reason).toContain('Original video file not found');

      // Verify status was reverted back to ARCHIVED
      const updatedVS = mockStore.vaultSync.get('r1');
      expect(updatedVS.archiveStatus).toBe(ArchiveStatus.ARCHIVED);
    });

    it('succeeds if video is found and restores correctly', async () => {
      const entry = { id: 'r1', date: daysAgo(45), archiveStatus: ArchiveStatus.ARCHIVED };
      const vs = { id: 'r1', archiveStatus: ArchiveStatus.ARCHIVED };
      mockStore.entries.set('r1', entry);
      mockStore.vaultSync.set('r1', vs);

      const res = await restoreEntry(entry);
      expect(res.success).toBe(true);

      // Verify video blob is saved locally
      expect(mockStore.mediaBlobs.has('r1')).toBe(true);

      // Verify status is ACTIVE
      const updatedVS = mockStore.vaultSync.get('r1');
      expect(updatedVS.archiveStatus).toBe(ArchiveStatus.ACTIVE);
    });
  });
});

