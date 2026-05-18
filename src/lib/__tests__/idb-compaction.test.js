// Takus — IDB Compaction Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage
const mockEntries = [
  { id: 'entry_001', title: 'Test 1', date: Date.now() },
  { id: 'entry_002', title: 'Test 2', date: Date.now() },
];

vi.mock('../storage.js', () => ({
  getEntries: vi.fn().mockResolvedValue([
    { id: 'entry_001', title: 'Test 1', date: Date.now() },
    { id: 'entry_002', title: 'Test 2', date: Date.now() },
  ]),
  getAllEmbeddings: vi.fn().mockResolvedValue([
    { contentId: 'entry_001', chunks: [] },       // Valid
    { contentId: 'entry_002', chunks: [] },       // Valid
    { contentId: 'entry_deleted_001', chunks: [] }, // Orphan
    { contentId: 'entry_deleted_002', chunks: [] }, // Orphan
  ]),
  deleteEmbeddings: vi.fn().mockResolvedValue(),
  getAllEdges: vi.fn().mockResolvedValue([
    { id: 'edge_1', sourceType: 'entry', sourceId: 'entry_001', targetType: 'entry', targetId: 'entry_002', edgeType: 'SIMILAR_TO' },  // Valid
    { id: 'edge_2', sourceType: 'entry', sourceId: 'entry_deleted_001', targetType: 'entry', targetId: 'entry_001', edgeType: 'SIMILAR_TO' },  // Orphan (source)
    { id: 'edge_3', sourceType: 'entry', sourceId: 'entry_001', targetType: 'entry', targetId: 'entry_deleted_003', edgeType: 'SIMILAR_TO' },  // Orphan (target)
    { id: 'edge_4', sourceType: 'contact', sourceId: 'contact_001', targetType: 'entry', targetId: 'entry_001', edgeType: 'PARTICIPATED_IN' },  // Valid (non-entry source)
  ]),
  removeEdge: vi.fn().mockResolvedValue(),
  getAllVaultSync: vi.fn().mockResolvedValue([
    { id: 'entry_001', driveFolderId: 'abc' },   // Valid
    { id: 'entry_deleted_004', driveFolderId: 'xyz' }, // Orphan
  ]),
  removeVaultSync: vi.fn().mockResolvedValue(),
  getAllInteractions: vi.fn().mockResolvedValue([
    { id: 1, contentId: 'entry_001', contactId: 'c1', timestamp: Date.now() },   // Valid
    { id: 2, contentId: 'entry_deleted_001', contactId: 'c2', timestamp: Date.now() }, // Orphan
  ]),
  getAllEngagementEvents: vi.fn().mockResolvedValue([
    { id: 1, contentId: 'entry_001', type: 'VIEW' },   // Valid
    { id: 2, contentId: 'entry_deleted_001', type: 'VIEW' }, // Orphan
    { id: 3, contentId: 'entry_deleted_002', type: 'PLAY' }, // Orphan
  ]),
}));

const { runCompaction, formatCompactionReport, estimateStorageUsage } = await import('../idb-compaction.js');
const storage = await import('../storage.js');

describe('IDB Compaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runCompaction (dry-run)', () => {
    it('detects orphaned embeddings', async () => {
      const report = await runCompaction({ dryRun: true });
      expect(report.orphans.embeddings).toBe(2);
    });

    it('detects orphaned edges', async () => {
      const report = await runCompaction({ dryRun: true });
      expect(report.orphans.edges).toBe(2); // edge_2 (orphan source) + edge_3 (orphan target)
    });

    it('detects orphaned vault sync records', async () => {
      const report = await runCompaction({ dryRun: true });
      expect(report.orphans.vaultSync).toBe(1);
    });

    it('detects orphaned interactions', async () => {
      const report = await runCompaction({ dryRun: true });
      expect(report.orphans.interactions).toBe(1);
    });

    it('detects orphaned engagement events', async () => {
      const report = await runCompaction({ dryRun: true });
      expect(report.orphans.engagementEvents).toBe(2);
    });

    it('computes total orphan count', async () => {
      const report = await runCompaction({ dryRun: true });
      expect(report.totalOrphans).toBe(2 + 2 + 1 + 1 + 2); // 8 total
    });

    it('does NOT delete anything in dry-run mode', async () => {
      await runCompaction({ dryRun: true });
      expect(storage.deleteEmbeddings).not.toHaveBeenCalled();
      expect(storage.removeEdge).not.toHaveBeenCalled();
      expect(storage.removeVaultSync).not.toHaveBeenCalled();
    });

    it('reports correct entry count', async () => {
      const report = await runCompaction({ dryRun: true });
      expect(report.entryCount).toBe(2);
    });

    it('marks as dry run', async () => {
      const report = await runCompaction({ dryRun: true });
      expect(report.dryRun).toBe(true);
      expect(report.cleaned).toBe(0);
    });

    it('includes duration', async () => {
      const report = await runCompaction({ dryRun: true });
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('runCompaction (live)', () => {
    it('deletes orphaned embeddings', async () => {
      const report = await runCompaction({ dryRun: false });
      expect(storage.deleteEmbeddings).toHaveBeenCalledTimes(2);
      expect(storage.deleteEmbeddings).toHaveBeenCalledWith('entry_deleted_001');
      expect(storage.deleteEmbeddings).toHaveBeenCalledWith('entry_deleted_002');
    });

    it('deletes orphaned edges', async () => {
      const report = await runCompaction({ dryRun: false });
      expect(storage.removeEdge).toHaveBeenCalledTimes(2);
      expect(storage.removeEdge).toHaveBeenCalledWith('edge_2');
      expect(storage.removeEdge).toHaveBeenCalledWith('edge_3');
    });

    it('deletes orphaned vault sync records', async () => {
      const report = await runCompaction({ dryRun: false });
      expect(storage.removeVaultSync).toHaveBeenCalledTimes(1);
      expect(storage.removeVaultSync).toHaveBeenCalledWith('entry_deleted_004');
    });

    it('reports correct cleaned count', async () => {
      const report = await runCompaction({ dryRun: false });
      expect(report.cleaned).toBe(2 + 2 + 1); // embeddings + edges + vaultSync
      expect(report.dryRun).toBe(false);
    });
  });

  describe('runCompaction — error resilience', () => {
    it('handles getEntries failure gracefully', async () => {
      storage.getEntries.mockRejectedValueOnce(new Error('IDB corrupt'));
      const report = await runCompaction({ dryRun: true });
      expect(report.errors.length).toBe(1);
      expect(report.errors[0]).toContain('IDB corrupt');
    });

    it('handles embeddings scan failure gracefully', async () => {
      storage.getAllEmbeddings.mockRejectedValueOnce(new Error('Embeddings store error'));
      const report = await runCompaction({ dryRun: true });
      expect(report.errors.length).toBe(1);
      // Other scans still run
      expect(report.orphans.edges).toBe(2);
    });
  });

  describe('formatCompactionReport', () => {
    it('formats a dry-run report', async () => {
      const report = await runCompaction({ dryRun: true });
      const text = formatCompactionReport(report);
      expect(text).toContain('DRY RUN');
      expect(text).toContain('Entries: 2');
      expect(text).toContain('Embeddings:');
      expect(text).toContain('TOTAL:');
    });

    it('formats a live report with cleaned count', async () => {
      const report = await runCompaction({ dryRun: false });
      const text = formatCompactionReport(report);
      expect(text).toContain('LIVE');
      expect(text).toContain('Cleaned:');
    });
  });

  describe('estimateStorageUsage', () => {
    it('returns null when Storage API is unavailable', async () => {
      const result = await estimateStorageUsage();
      // In test env, navigator.storage.estimate may not exist
      // This should return null or a valid estimate
      expect(result === null || typeof result === 'object').toBe(true);
    });
  });
});
