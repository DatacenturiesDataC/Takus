// Takus — Data Import Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock storage layer ───────────────────────────────────────────────────────
const mockSaveEntry = vi.fn(() => Promise.resolve());
const mockGetEntry = vi.fn(() => Promise.resolve(null));
const mockSaveContact = vi.fn(() => Promise.resolve());
const mockGetContact = vi.fn(() => Promise.resolve(null));
const mockSaveNode = vi.fn(() => Promise.resolve());
const mockGetNode = vi.fn(() => Promise.resolve(null));

vi.mock('../storage.js', () => ({
  saveEntry: (...args) => mockSaveEntry(...args),
  getEntry: (...args) => mockGetEntry(...args),
  saveContact: (...args) => mockSaveContact(...args),
  getContact: (...args) => mockGetContact(...args),
  saveNode: (...args) => mockSaveNode(...args),
  getNode: (...args) => mockGetNode(...args),
}));

// ── Mock task-store ──────────────────────────────────────────────────────────
const mockCreateTask = vi.fn(() => Promise.resolve());

vi.mock('../graph/task-store.js', () => ({
  createTask: (...args) => mockCreateTask(...args),
}));

// ── Mock schema-validator (pass-through by default, null for invalid) ────────
vi.mock('../schema-validator.js', () => ({
  validateEntry: vi.fn((r) => {
    if (!r || typeof r !== 'object' || !r.id) return null;
    return { ...r };
  }),
  validateContact: vi.fn((r) => {
    if (!r || typeof r !== 'object' || !r.id) return null;
    return { ...r };
  }),
}));

import { importFromJSON } from '../import-engine.js';
import { validateEntry, validateContact } from '../schema-validator.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeBundle(overrides = {}) {
  return {
    version: 1,
    platform: 'takus',
    exportedAt: new Date().toISOString(),
    entries: [],
    ...overrides,
  };
}

function makeEntry(id = 'entry_1') {
  return {
    id,
    title: 'Sprint Planning',
    date: Date.now(),
    type: 'meeting',
    textContent: 'Discussed sprint goals.',
    aiSummary: 'Sprint planning session.',
  };
}

function makeContact(id = 'contact_1') {
  return {
    id,
    name: 'Alice Johnson',
    email: 'alice@example.com',
    closenessScore: 50,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeTask(id = 'task_1') {
  return {
    id,
    title: 'Build search feature',
    action: 'TAKUS_TASK',
    status: 'pending',
    assignee: 'takus',
    _contentId: 'entry_1',
  };
}

function makeGoal(id = 'goal_1') {
  return {
    id,
    title: 'Ship v1.0',
    description: 'First public release',
    state: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('Data Import Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults: no duplicates, validation passes
    mockGetEntry.mockResolvedValue(null);
    mockGetContact.mockResolvedValue(null);
    mockGetNode.mockResolvedValue(null);
    mockSaveEntry.mockResolvedValue(undefined);
    mockSaveContact.mockResolvedValue(undefined);
    mockSaveNode.mockResolvedValue(undefined);
    mockCreateTask.mockResolvedValue(undefined);
    validateEntry.mockImplementation((r) => {
      if (!r || typeof r !== 'object' || !r.id) return null;
      return { ...r };
    });
    validateContact.mockImplementation((r) => {
      if (!r || typeof r !== 'object' || !r.id) return null;
      return { ...r };
    });
  });

  // ── 1. Valid export with entries ──────────────────────────────────────────
  describe('importFromJSON — valid export', () => {
    it('imports entries and returns correct counts', async () => {
      const bundle = makeBundle({
        entries: [makeEntry('e1'), makeEntry('e2'), makeEntry('e3')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
      expect(mockSaveEntry).toHaveBeenCalledTimes(3);
    });

    it('checks for duplicates via getEntry before saving', async () => {
      const bundle = makeBundle({ entries: [makeEntry('e1')] });

      await importFromJSON(JSON.stringify(bundle));

      expect(mockGetEntry).toHaveBeenCalledWith('e1');
      expect(mockSaveEntry).toHaveBeenCalledTimes(1);
    });

    it('passes validated entry to saveEntry', async () => {
      const entry = makeEntry('e1');
      const bundle = makeBundle({ entries: [entry] });

      await importFromJSON(JSON.stringify(bundle));

      expect(mockSaveEntry).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'e1', title: 'Sprint Planning' })
      );
    });
  });

  // ── 2. Duplicate handling ────────────────────────────────────────────────
  describe('importFromJSON — duplicate handling', () => {
    it('skips entries that already exist', async () => {
      mockGetEntry.mockResolvedValue({ id: 'e1', title: 'Existing' });
      const bundle = makeBundle({ entries: [makeEntry('e1')] });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors).toEqual([]);
      expect(mockSaveEntry).not.toHaveBeenCalled();
    });

    it('imports new entries while skipping duplicates', async () => {
      mockGetEntry
        .mockResolvedValueOnce({ id: 'e1', title: 'Existing' }) // duplicate
        .mockResolvedValueOnce(null); // new
      const bundle = makeBundle({
        entries: [makeEntry('e1'), makeEntry('e2')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(mockSaveEntry).toHaveBeenCalledTimes(1);
    });
  });

  // ── 3. Validation errors ─────────────────────────────────────────────────
  describe('importFromJSON — validation errors', () => {
    it('skips entries that fail validation and records error', async () => {
      validateEntry.mockReturnValue(null);
      const bundle = makeBundle({
        entries: [{ id: 'bad_1', title: null }],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('failed validation');
      expect(result.errors[0]).toContain('bad_1');
      expect(mockSaveEntry).not.toHaveBeenCalled();
    });

    it('records id as "unknown" when entry has no id', async () => {
      validateEntry.mockReturnValue(null);
      const bundle = makeBundle({
        entries: [{ title: 'No ID entry' }],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.errors[0]).toContain('unknown');
    });

    it('continues importing valid entries after a validation failure', async () => {
      validateEntry
        .mockReturnValueOnce(null) // first entry fails
        .mockReturnValueOnce({ id: 'e2', title: 'Good' }); // second succeeds
      const bundle = makeBundle({
        entries: [{ id: 'bad' }, makeEntry('e2')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });

  // ── 4. Invalid JSON string ───────────────────────────────────────────────
  describe('importFromJSON — invalid JSON', () => {
    it('returns error for non-JSON input', async () => {
      const result = await importFromJSON('this is not json');

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid JSON');
    });

    it('returns error for empty string', async () => {
      const result = await importFromJSON('');

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(1);
    });

    it('returns error for truncated JSON', async () => {
      const result = await importFromJSON('{ "version": 1, "entries": [');

      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid JSON');
    });
  });

  // ── 5. Empty export ──────────────────────────────────────────────────────
  describe('importFromJSON — empty export', () => {
    it('returns zeros for valid bundle with empty entries', async () => {
      const bundle = makeBundle({ entries: [] });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('handles bundle with only empty optional arrays', async () => {
      const bundle = makeBundle({
        entries: [],
        tasks: [],
        goals: [],
        contacts: [],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  // ── 6. Contacts import ───────────────────────────────────────────────────
  describe('importFromJSON — with contacts', () => {
    it('imports contacts from bundle', async () => {
      const bundle = makeBundle({
        entries: [],
        contacts: [makeContact('c1'), makeContact('c2')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(2);
      expect(mockSaveContact).toHaveBeenCalledTimes(2);
    });

    it('skips duplicate contacts', async () => {
      mockGetContact.mockResolvedValue({ id: 'c1', name: 'Existing' });
      const bundle = makeBundle({
        entries: [],
        contacts: [makeContact('c1')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockSaveContact).not.toHaveBeenCalled();
    });

    it('skips contacts that fail validation', async () => {
      validateContact.mockReturnValue(null);
      const bundle = makeBundle({
        entries: [],
        contacts: [{ id: 'c_bad' }],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockSaveContact).not.toHaveBeenCalled();
    });

    it('imports entries and contacts together', async () => {
      const bundle = makeBundle({
        entries: [makeEntry('e1')],
        contacts: [makeContact('c1')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(2);
      expect(mockSaveEntry).toHaveBeenCalledTimes(1);
      expect(mockSaveContact).toHaveBeenCalledTimes(1);
    });
  });

  // ── 7. Tasks and goals import ────────────────────────────────────────────
  describe('importFromJSON — with tasks and goals', () => {
    it('imports tasks via createTask', async () => {
      const bundle = makeBundle({
        entries: [],
        tasks: [makeTask('t1'), makeTask('t2')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(2);
      expect(mockCreateTask).toHaveBeenCalledTimes(2);
    });

    it('passes correct task data and contentId to createTask', async () => {
      const task = makeTask('t1');
      task._contentId = 'entry_42';
      const bundle = makeBundle({ entries: [], tasks: [task] });

      await importFromJSON(JSON.stringify(bundle));

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 't1',
          title: 'Build search feature',
          status: 'pending',
          assignee: 'takus',
          action: 'TAKUS_TASK',
        }),
        'entry_42'
      );
    });

    it('skips duplicate tasks', async () => {
      mockGetNode.mockResolvedValue({ id: 't1', type: 'task' });
      const bundle = makeBundle({
        entries: [],
        tasks: [makeTask('t1')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it('skips tasks without an id', async () => {
      const bundle = makeBundle({
        entries: [],
        tasks: [{ title: 'No ID task' }],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(0);
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it('imports goals via saveNode', async () => {
      const bundle = makeBundle({
        entries: [],
        goals: [makeGoal('g1')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(1);
      expect(mockSaveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'g1',
          type: 'goal',
          appId: 'goals',
          properties: expect.objectContaining({
            title: 'Ship v1.0',
            description: 'First public release',
            state: 'active',
          }),
        })
      );
    });

    it('skips duplicate goals', async () => {
      mockGetNode.mockResolvedValue({ id: 'g1', type: 'goal' });
      const bundle = makeBundle({
        entries: [],
        goals: [makeGoal('g1')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockSaveNode).not.toHaveBeenCalled();
    });

    it('skips goals without an id', async () => {
      const bundle = makeBundle({
        entries: [],
        goals: [{ title: 'No ID goal' }],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(0);
      expect(mockSaveNode).not.toHaveBeenCalled();
    });

    it('imports entries, tasks, goals, and contacts together', async () => {
      const bundle = makeBundle({
        entries: [makeEntry('e1')],
        tasks: [makeTask('t1')],
        goals: [makeGoal('g1')],
        contacts: [makeContact('c1')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(4);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
      expect(mockSaveEntry).toHaveBeenCalledTimes(1);
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
      expect(mockSaveNode).toHaveBeenCalledTimes(1);
      expect(mockSaveContact).toHaveBeenCalledTimes(1);
    });
  });

  // ── 8. Invalid export format ─────────────────────────────────────────────
  describe('importFromJSON — invalid export format', () => {
    it('rejects non-object JSON (string)', async () => {
      const result = await importFromJSON(JSON.stringify('just a string'));

      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('not a valid export bundle');
    });

    it('rejects null', async () => {
      const result = await importFromJSON(JSON.stringify(null));

      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(1);
    });

    it('rejects object without version field', async () => {
      const result = await importFromJSON(JSON.stringify({ entries: [] }));

      expect(result.errors[0]).toContain('version');
    });

    it('rejects object without entries array', async () => {
      const result = await importFromJSON(JSON.stringify({ version: 1 }));

      expect(result.errors[0]).toContain('entries');
    });

    it('rejects object with entries as non-array', async () => {
      const result = await importFromJSON(JSON.stringify({ version: 1, entries: 'not array' }));

      expect(result.errors[0]).toContain('entries');
    });
  });

  // ── 9. Error handling for storage failures ───────────────────────────────
  describe('importFromJSON — storage errors', () => {
    it('catches and records saveEntry errors', async () => {
      mockSaveEntry.mockRejectedValue(new Error('Quota exceeded'));
      const bundle = makeBundle({ entries: [makeEntry('e1')] });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('e1');
      expect(result.errors[0]).toContain('Quota exceeded');
    });

    it('continues importing after a single entry save failure', async () => {
      mockSaveEntry
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockResolvedValueOnce(undefined);
      const bundle = makeBundle({
        entries: [makeEntry('e1'), makeEntry('e2')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(mockSaveEntry).toHaveBeenCalledTimes(2);
    });

    it('catches and records createTask errors', async () => {
      mockCreateTask.mockRejectedValue(new Error('Node write failed'));
      const bundle = makeBundle({
        entries: [],
        tasks: [makeTask('t1')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('t1');
      expect(result.errors[0]).toContain('Node write failed');
    });

    it('catches and records saveNode errors for goals', async () => {
      mockSaveNode.mockRejectedValue(new Error('DB locked'));
      const bundle = makeBundle({
        entries: [],
        goals: [makeGoal('g1')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('g1');
      expect(result.errors[0]).toContain('DB locked');
    });

    it('catches and records saveContact errors', async () => {
      mockSaveContact.mockRejectedValue(new Error('Contact write failed'));
      const bundle = makeBundle({
        entries: [],
        contacts: [makeContact('c1')],
      });

      const result = await importFromJSON(JSON.stringify(bundle));

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('c1');
      expect(result.errors[0]).toContain('Contact write failed');
    });
  });

  // ── 10. Task field defaults ──────────────────────────────────────────────
  describe('importFromJSON — task field defaults', () => {
    it('applies defaults for missing optional task fields', async () => {
      const minimalTask = { id: 't_min' };
      const bundle = makeBundle({ entries: [], tasks: [minimalTask] });

      await importFromJSON(JSON.stringify(bundle));

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 't_min',
          title: 'Untitled Task',
          status: 'pending',
          assignee: 'me',
          action: 'TAKUS_TASK',
          urgency: 'normal',
          steps: [],
          integrations: [],
        }),
        null
      );
    });

    it('uses sourceContentId as fallback for _contentId', async () => {
      const task = { id: 't1', sourceContentId: 'src_42' };
      const bundle = makeBundle({ entries: [], tasks: [task] });

      await importFromJSON(JSON.stringify(bundle));

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 't1' }),
        'src_42'
      );
    });
  });
});
