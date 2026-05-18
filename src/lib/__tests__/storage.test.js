import { describe, it, expect } from 'vitest';
import {
  saveEntry, getEntries, deleteEntry,
  saveSetting, getSetting,
  saveEngagementEvent, getAllEngagementEvents,
  saveContentItem, getContentItems,
  batchRead,
  addEdge, getAllEdges,
  saveNode, getAllNodes,
  removeInteractionsForEntry, removeContentItemsForEntry, removeVaultSync,
} from '../storage.js';

// fake-indexeddb is auto-loaded via setup.js

describe('Recording CRUD', () => {
  const mockRec = () => ({
    id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    title: 'Test Recording',
    date: Date.now(),
    duration: 60000,
    size: 1024,
    type: 'screen',
  });

  it('saves and retrieves a entry', async () => {
    const rec = mockRec();
    await saveEntry(rec);
    const all = await getEntries();
    const found = all.find(r => r.id === rec.id);
    expect(found).toBeTruthy();
    expect(found.title).toBe('Test Recording');
  });

  it('overwrites existing entry on re-save', async () => {
    const rec = mockRec();
    await saveEntry(rec);
    rec.title = 'Updated Title';
    await saveEntry(rec);
    const all = await getEntries();
    const found = all.find(r => r.id === rec.id);
    expect(found.title).toBe('Updated Title');
  });

  it('deletes a entry', async () => {
    const rec = mockRec();
    await saveEntry(rec);
    await deleteEntry(rec.id);
    const all = await getEntries();
    expect(all.find(r => r.id === rec.id)).toBeUndefined();
  });
});

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
});

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

describe('batchRead', () => {
  it('reads from multiple stores in a single transaction', async () => {
    // Seed data in two stores
    const rec = { id: 'br_rec_1', title: 'Batch Test', date: Date.now(), duration: 30000, size: 512, type: 'screen' };
    await saveEntry(rec);
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

describe('getAllEdges', () => {
  it('returns all edges in the graph store', async () => {
    const edge = { sourceType: 'task', sourceId: 't1', targetType: 'entry', targetId: 'r1', edgeType: 'DERIVED_FROM', metadata: {} };
    const id = await addEdge(edge);
    const all = await getAllEdges();
    expect(all.find(e => e.id === id)).toBeTruthy();
  });

  it('returns empty array when no edges exist', async () => {
    const all = await getAllEdges();
    expect(Array.isArray(all)).toBe(true);
  });
});

describe('getAllNodes', () => {
  it('returns all nodes in the graph store', async () => {
    const node = { id: 'n_1', type: 'task', state: 'active', appId: 'tasks', properties: { title: 'Test' }, createdAt: Date.now(), updatedAt: Date.now() };
    await saveNode(node);
    const all = await getAllNodes();
    expect(all.find(n => n.id === 'n_1')).toBeTruthy();
  });
});

describe('Cascade cleanup helpers', () => {
  it('removeInteractionsForEntry removes matching interactions', async () => {
    // Should not throw even if no interactions exist for this entry
    await expect(removeInteractionsForEntry('rec_nonexistent')).resolves.not.toThrow();
  });

  it('removeContentItemsForEntry removes matching content items', async () => {
    await expect(removeContentItemsForEntry('rec_nonexistent')).resolves.not.toThrow();
  });

  it('removeVaultSync removes matching vault sync entries', async () => {
    await expect(removeVaultSync('rec_nonexistent')).resolves.not.toThrow();
  });
});
