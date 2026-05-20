import { describe, it, expect } from 'vitest';
import {
  saveEntry, getEntries, getEntry, deleteEntry, clearAllEntries,
  saveSetting, getSetting,
  saveEngagementEvent, getAllEngagementEvents, getEngagementsByContent,
  saveContentItem, getContentItems,
  batchRead,
  addEdge, getAllEdges, getEdgesFromNode, getEdgesToNode, getEdgesForNode, removeEdge, removeEdgesForNode,
  saveNode, getAllNodes, getNode, getNodesByType, deleteNode,
  removeInteractionsForEntry, removeContentItemsForEntry, removeVaultSync,
  saveEmbeddings, getEmbeddings, deleteEmbeddings, getAllEmbeddings,
  saveContact, getContacts, getContact, deleteContact,
  saveInteraction, getInteractionsForContact, getAllInteractions,
  saveWikiEntry, getWikiEntries, deleteWikiEntry,
  saveMediaBlob, getMediaBlob, deleteMediaBlob,
  saveStepCheckpoint, getStepCheckpoint, deleteStepCheckpoint, getAllPendingCheckpoints, getCheckpointsForEntry,
  saveVaultSync, getVaultSync, getAllVaultSync,
  saveRecoveryChunk, getRecoveryData, clearRecoveryData,
  updateRecord, updateNode,
} from '../storage.js';

// fake-indexeddb is auto-loaded via setup.js

// ── Entry CRUD ────────────────────────────────────────────────────────────────

describe('Entry CRUD', () => {
  const mockEntry = () => ({
    id: 'ent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    title: 'Test Entry',
    date: Date.now(),
    duration: 60000,
    size: 1024,
    type: 'screen',
  });

  it('saves and retrieves an entry', async () => {
    const entry = mockEntry();
    await saveEntry(entry);
    const all = await getEntries();
    const found = all.find(r => r.id === entry.id);
    expect(found).toBeTruthy();
    expect(found.title).toBe('Test Entry');
  });

  it('gets a single entry by ID', async () => {
    const entry = mockEntry();
    await saveEntry(entry);
    const found = await getEntry(entry.id);
    expect(found).toBeTruthy();
    expect(found.id).toBe(entry.id);
  });

  it('returns null for nonexistent entry', async () => {
    const found = await getEntry('nonexistent_id_xyz');
    expect(found).toBeNull();
  });

  it('overwrites existing entry on re-save', async () => {
    const entry = mockEntry();
    await saveEntry(entry);
    entry.title = 'Updated Title';
    await saveEntry(entry);
    const all = await getEntries();
    const found = all.find(r => r.id === entry.id);
    expect(found.title).toBe('Updated Title');
  });

  it('deletes an entry', async () => {
    const entry = mockEntry();
    await saveEntry(entry);
    await deleteEntry(entry.id);
    const all = await getEntries();
    expect(all.find(r => r.id === entry.id)).toBeUndefined();
  });

  it('clearAllEntries removes all entries', async () => {
    await saveEntry(mockEntry());
    await saveEntry(mockEntry());
    await clearAllEntries();
    const all = await getEntries();
    expect(all.length).toBe(0);
  });
});

// ── Settings CRUD ─────────────────────────────────────────────────────────────

describe('Settings CRUD', () => {
  it('saves and retrieves a setting', async () => {
    await saveSetting('testKey', 'testValue');
    const val = await getSetting('testKey');
    expect(val).toBe('testValue');
  });

  it('overwrites existing setting', async () => {
    await saveSetting('myKey', 'v1');
    await saveSetting('myKey', 'v2');
    expect(await getSetting('myKey')).toBe('v2');
  });

  it('returns null for missing key', async () => {
    const val = await getSetting('nonexistent_key_xyz');
    expect(val).toBeNull();
  });

  it('handles complex values', async () => {
    const obj = { nested: { array: [1, 2, 3], flag: true } };
    await saveSetting('complex', obj);
    const val = await getSetting('complex');
    expect(val).toEqual(obj);
  });
});

// ── Engagement Events ─────────────────────────────────────────────────────────

describe('Engagement Events CRUD', () => {
  it('saves and retrieves engagement events', async () => {
    const event = { id: 'eng_1', contentId: 'c1', contactId: 'p1', type: 'view', timestamp: Date.now() };
    await saveEngagementEvent(event);
    const all = await getAllEngagementEvents();
    expect(all.find(e => e.id === 'eng_1')).toBeTruthy();
  });

  it('returns an array when no events exist', async () => {
    const all = await getAllEngagementEvents();
    expect(Array.isArray(all)).toBe(true);
  });

  it('queries engagements by content ID', async () => {
    const cId = 'content_eng_' + Date.now();
    await saveEngagementEvent({ id: 'eng_c1', contentId: cId, contactId: 'p1', type: 'view', timestamp: Date.now() });
    await saveEngagementEvent({ id: 'eng_c2', contentId: cId, contactId: 'p2', type: 'view', timestamp: Date.now() });
    const byContent = await getEngagementsByContent(cId);
    expect(byContent.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Content Items ─────────────────────────────────────────────────────────────

describe('Content Items CRUD', () => {
  it('saves and retrieves content items', async () => {
    const item = { id: 'ci_1', title: 'Test Content', knowledgeLevel: 'L2', ownerId: 'user1' };
    await saveContentItem(item);
    const all = await getContentItems();
    const found = all.find(i => i.id === 'ci_1');
    expect(found).toBeTruthy();
    expect(found.knowledgeLevel).toBe('L2');
  });

  it('updates content item on re-save', async () => {
    const item = { id: 'ci_2', title: 'Original', knowledgeLevel: 'L4', ownerId: 'user1' };
    await saveContentItem(item);
    item.knowledgeLevel = 'L1';
    await saveContentItem(item);
    const all = await getContentItems();
    expect(all.find(i => i.id === 'ci_2').knowledgeLevel).toBe('L1');
  });
});

// ── batchRead ─────────────────────────────────────────────────────────────────

describe('batchRead', () => {
  it('reads from multiple stores in a single transaction', async () => {
    const entry = { id: 'br_rec_1', title: 'Batch Test', date: Date.now(), duration: 30000, size: 512, type: 'screen' };
    await saveEntry(entry);
    await saveSetting('br_key', 'br_value');

    const result = await batchRead(['entries', 'settings']);

    expect(result).toHaveProperty('entries');
    expect(result).toHaveProperty('settings');
    expect(Array.isArray(result.entries)).toBe(true);
    expect(Array.isArray(result.settings)).toBe(true);
    expect(result.entries.find(r => r.id === 'br_rec_1')).toBeTruthy();
    expect(result.settings.find(s => s.key === 'br_key')).toBeTruthy();
  });

  it('returns empty arrays for empty stores', async () => {
    const result = await batchRead(['recovery']);
    expect(result.recovery).toEqual([]);
  });
});

// ── Graph Edges ───────────────────────────────────────────────────────────────

describe('Graph Edges', () => {
  const mkEdge = (src, tgt, type = 'DERIVED_FROM') => ({
    sourceType: 'entry', sourceId: src,
    targetType: 'task', targetId: tgt,
    edgeType: type, metadata: {},
  });

  it('adds an edge and returns its ID', async () => {
    const id = await addEdge(mkEdge('e1', 't1'));
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('retrieves all edges', async () => {
    await addEdge(mkEdge('e2', 't2'));
    const all = await getAllEdges();
    expect(all.find(e => e.sourceId === 'e2')).toBeTruthy();
  });

  it('queries edges FROM a node', async () => {
    await addEdge(mkEdge('src_from', 'tgt_from'));
    const from = await getEdgesFromNode('entry', 'src_from');
    expect(from.length).toBeGreaterThanOrEqual(1);
    expect(from[0].sourceId).toBe('src_from');
  });

  it('queries edges TO a node', async () => {
    await addEdge(mkEdge('src_to', 'tgt_to'));
    const to = await getEdgesToNode('task', 'tgt_to');
    expect(to.length).toBeGreaterThanOrEqual(1);
    expect(to[0].targetId).toBe('tgt_to');
  });

  it('queries all edges for a node (both directions)', async () => {
    await addEdge(mkEdge('both_src', 'both_tgt'));
    const edges = await getEdgesForNode('entry', 'both_src');
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });

  it('removes a single edge by ID', async () => {
    const id = await addEdge(mkEdge('rem_src', 'rem_tgt'));
    await removeEdge(id);
    const all = await getAllEdges();
    expect(all.find(e => e.id === id)).toBeFalsy();
  });

  it('removes all edges for a node', async () => {
    await addEdge(mkEdge('rmall_src', 'rmall_1'));
    await addEdge(mkEdge('rmall_src', 'rmall_2'));
    await removeEdgesForNode('entry', 'rmall_src');
    const edges = await getEdgesFromNode('entry', 'rmall_src');
    expect(edges.length).toBe(0);
  });

  it('returns empty array for non-existent node edges', async () => {
    const edges = await getEdgesFromNode('entry', 'nonexistent_xyz');
    expect(edges).toEqual([]);
  });
});

// ── Graph Nodes ───────────────────────────────────────────────────────────────

describe('Graph Nodes', () => {
  const mkNode = (id, type = 'task') => ({
    id, type, state: 'active', appId: 'tasks',
    properties: { title: `Test ${id}` },
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  it('saves and retrieves all nodes', async () => {
    await saveNode(mkNode('nd_1'));
    const all = await getAllNodes();
    expect(all.find(n => n.id === 'nd_1')).toBeTruthy();
  });

  it('gets a single node by ID', async () => {
    await saveNode(mkNode('nd_get'));
    const found = await getNode('nd_get');
    expect(found).toBeTruthy();
    expect(found.id).toBe('nd_get');
  });

  it('returns null for non-existent node', async () => {
    const found = await getNode('nonexistent_node_xyz');
    expect(found).toBeNull();
  });

  it('queries nodes by type', async () => {
    await saveNode(mkNode('nd_type_1', 'goal'));
    await saveNode(mkNode('nd_type_2', 'goal'));
    const goals = await getNodesByType('goal');
    expect(goals.length).toBeGreaterThanOrEqual(2);
    expect(goals.every(n => n.type === 'goal')).toBe(true);
  });

  it('deletes a node', async () => {
    await saveNode(mkNode('nd_del'));
    await deleteNode('nd_del');
    const found = await getNode('nd_del');
    expect(found).toBeNull();
  });
});

// ── Embeddings ────────────────────────────────────────────────────────────────

describe('Embeddings', () => {
  it('saves and retrieves embeddings by content ID', async () => {
    const chunks = [
      { chunkIndex: 0, text: 'hello', embedding: [0.1, 0.2, 0.3] },
      { chunkIndex: 1, text: 'world', embedding: [0.4, 0.5, 0.6] },
    ];
    await saveEmbeddings('emb_content_1', chunks);
    const retrieved = await getEmbeddings('emb_content_1');
    // getEmbeddings returns { contentId, chunks } or null
    expect(retrieved).toBeTruthy();
    expect(retrieved.chunks.length).toBe(2);
    expect(retrieved.chunks[0].embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('retrieves all embeddings', async () => {
    await saveEmbeddings('emb_all_1', [{ chunkIndex: 0, text: 'a', embedding: [1] }]);
    const all = await getAllEmbeddings();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('deletes embeddings by content ID', async () => {
    await saveEmbeddings('emb_del_1', [{ chunkIndex: 0, text: 'x', embedding: [9] }]);
    await deleteEmbeddings('emb_del_1');
    const retrieved = await getEmbeddings('emb_del_1');
    expect(retrieved).toBeNull();
  });

  it('returns null for non-existent content', async () => {
    const retrieved = await getEmbeddings('nonexistent_emb_xyz');
    expect(retrieved).toBeNull();
  });
});

// ── Contacts ──────────────────────────────────────────────────────────────────

describe('Contacts', () => {
  const mkContact = (id) => ({
    id, name: `Contact ${id}`, email: `${id}@test.com`,
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  it('saves and retrieves all contacts', async () => {
    await saveContact(mkContact('ct_1'));
    const all = await getContacts();
    expect(all.find(c => c.id === 'ct_1')).toBeTruthy();
  });

  it('gets a single contact by ID', async () => {
    await saveContact(mkContact('ct_get'));
    const found = await getContact('ct_get');
    expect(found).toBeTruthy();
    expect(found.name).toBe('Contact ct_get');
  });

  it('returns null for non-existent contact', async () => {
    const found = await getContact('nonexistent_contact_xyz');
    expect(found).toBeNull();
  });

  it('deletes a contact', async () => {
    await saveContact(mkContact('ct_del'));
    await deleteContact('ct_del');
    const found = await getContact('ct_del');
    expect(found).toBeNull();
  });
});

// ── Interactions ──────────────────────────────────────────────────────────────

describe('Interactions', () => {
  it('saves and retrieves interactions for a contact', async () => {
    const interaction = {
      id: 'int_1', contactId: 'ct_int', entryId: 'e_int',
      type: 'meeting', timestamp: Date.now(),
    };
    await saveInteraction(interaction);
    const forContact = await getInteractionsForContact('ct_int');
    expect(forContact.length).toBeGreaterThanOrEqual(1);
  });

  it('retrieves all interactions', async () => {
    const all = await getAllInteractions();
    expect(Array.isArray(all)).toBe(true);
  });
});

// ── Wiki ──────────────────────────────────────────────────────────────────────

describe('Wiki', () => {
  it('saves and retrieves wiki entries', async () => {
    const entry = { id: 'wiki_1', title: 'Test Wiki', content: '# Hello', date: Date.now(), createdAt: Date.now() };
    await saveWikiEntry(entry);
    const all = await getWikiEntries();
    expect(all.find(w => w.id === 'wiki_1')).toBeTruthy();
  });

  it('deletes a wiki entry', async () => {
    const entry = { id: 'wiki_del', title: 'Delete Me', content: '', date: Date.now(), createdAt: Date.now() };
    await saveWikiEntry(entry);
    await deleteWikiEntry('wiki_del');
    const all = await getWikiEntries();
    expect(all.find(w => w.id === 'wiki_del')).toBeFalsy();
  });
});

// ── Media Blobs ───────────────────────────────────────────────────────────────

describe('Media Blobs', () => {
  it('saves and retrieves a media blob', async () => {
    const blob = new Blob(['test-data'], { type: 'video/webm' });
    await saveMediaBlob('mb_1', blob);
    const retrieved = await getMediaBlob('mb_1');
    // fake-indexeddb may not fully preserve Blob structure
    expect(retrieved).toBeTruthy();
  });

  it('returns null for non-existent blob', async () => {
    const retrieved = await getMediaBlob('nonexistent_blob_xyz');
    expect(retrieved).toBeNull();
  });

  it('deletes a media blob', async () => {
    const blob = new Blob(['del-data'], { type: 'video/webm' });
    await saveMediaBlob('mb_del', blob);
    await deleteMediaBlob('mb_del');
    const retrieved = await getMediaBlob('mb_del');
    expect(retrieved).toBeNull();
  });
});

// ── Step Checkpoints ──────────────────────────────────────────────────────────

describe('Step Checkpoints', () => {
  it('saves and retrieves a checkpoint', async () => {
    const cp = {
      taskKey: 'cp_1:0', contentId: 'cp_ent_1', taskIndex: 0,
      steps: [{ step_id: 's1', status: 'pending' }],
      updatedAt: Date.now(),
    };
    await saveStepCheckpoint(cp);
    const found = await getStepCheckpoint('cp_1:0');
    expect(found).toBeTruthy();
    expect(found.contentId).toBe('cp_ent_1');
  });

  it('gets checkpoints for a specific entry', async () => {
    const cId = 'cp_ent_multi_' + Date.now();
    await saveStepCheckpoint({ taskKey: `${cId}:0`, contentId: cId, taskIndex: 0, steps: [], updatedAt: Date.now() });
    await saveStepCheckpoint({ taskKey: `${cId}:1`, contentId: cId, taskIndex: 1, steps: [], updatedAt: Date.now() });
    const cps = await getCheckpointsForEntry(cId);
    expect(cps.length).toBeGreaterThanOrEqual(2);
  });

  it('deletes a checkpoint', async () => {
    await saveStepCheckpoint({ taskKey: 'cp_del', contentId: 'x', taskIndex: 0, steps: [], updatedAt: Date.now() });
    await deleteStepCheckpoint('cp_del');
    const found = await getStepCheckpoint('cp_del');
    expect(found).toBeNull();
  });

  it('retrieves all pending checkpoints', async () => {
    const all = await getAllPendingCheckpoints();
    expect(Array.isArray(all)).toBe(true);
  });
});

// ── Vault Sync ────────────────────────────────────────────────────────────────

describe('Vault Sync', () => {
  it('saves and retrieves vault sync records', async () => {
    const record = { id: 'vs_1', entryId: 'e_vs', provider: 'google', syncedAt: Date.now() };
    await saveVaultSync(record);
    const found = await getVaultSync('vs_1');
    expect(found).toBeTruthy();
    expect(found.provider).toBe('google');
  });

  it('retrieves all vault sync records', async () => {
    const all = await getAllVaultSync();
    expect(Array.isArray(all)).toBe(true);
  });
});

// ── Recovery ──────────────────────────────────────────────────────────────────

describe('Recovery', () => {
  it('saves and retrieves recovery chunks', async () => {
    const chunks = [new Blob(['chunk1']), new Blob(['chunk2'])];
    await saveRecoveryChunk('entry_1', chunks);
    const data = await getRecoveryData('entry_1');
    expect(data).toBeTruthy();
  });

  it('clears recovery data', async () => {
    await saveRecoveryChunk('entry_clear', [new Blob(['x'])]);
    await clearRecoveryData('entry_clear');
    const data = await getRecoveryData('entry_clear');
    expect(data).toBeNull();
  });
});

// ── Cascade Cleanup ───────────────────────────────────────────────────────────

describe('Cascade cleanup helpers', () => {
  it('removeInteractionsForEntry does not throw for non-existent entry', async () => {
    await expect(removeInteractionsForEntry('entry_nonexistent')).resolves.not.toThrow();
  });

  it('removeContentItemsForEntry does not throw for non-existent entry', async () => {
    await expect(removeContentItemsForEntry('entry_nonexistent')).resolves.not.toThrow();
  });

  it('removeVaultSync does not throw for non-existent entry', async () => {
    await expect(removeVaultSync('entry_nonexistent')).resolves.not.toThrow();
  });
});

// ── Atomic updates ───────────────────────────────────────────────────────────

describe('Atomic Updates', () => {
  it('updateRecord atomically modifies settings store record', async () => {
    await saveSetting('opt_atomic', { count: 10 });
    
    // Increment atomically
    const res = await updateRecord('settings', 'opt_atomic', (record) => {
      if (!record) return;
      return { ...record, value: { count: record.value.count + 5 } };
    });

    expect(res.value.count).toBe(15);
    const updated = await getSetting('opt_atomic');
    expect(updated.count).toBe(15);
  });

  it('updateRecord returns undefined/no-op if updater returns undefined', async () => {
    await saveSetting('opt_noop', { status: 'original' });
    const res = await updateRecord('settings', 'opt_noop', (record) => {
      return undefined;
    });

    expect(res.value.status).toBe('original');
    const finalVal = await getSetting('opt_noop');
    expect(finalVal.status).toBe('original');
  });

  it('updateNode atomically modifies task graph node properties', async () => {
    const node = {
      id: 'nd_atomic_1', type: 'task', state: 'active', appId: 'tasks',
      properties: { title: 'Atomic Task', version: 1 },
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    await saveNode(node);

    const res = await updateNode('nd_atomic_1', (n) => {
      if (!n) return;
      n.properties.version = 2;
      return n;
    });

    expect(res).toBeTruthy();
    expect(res.properties.version).toBe(2);
    expect(res.updatedAt).toBeGreaterThanOrEqual(node.updatedAt);

    const found = await getNode('nd_atomic_1');
    expect(found.properties.version).toBe(2);
  });

  it('updateNode returns null/no-op for non-existent node when updater returns null/undefined', async () => {
    const res = await updateNode('nd_nonexistent', (n) => {
      if (!n) return null;
      return n;
    });
    expect(res).toBeNull();
  });
});

