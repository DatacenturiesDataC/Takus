// Takus — Storage Unit Tests (IndexedDB via fake-indexeddb)
import { describe, it, expect, beforeEach } from 'vitest';
import { saveRecording, getRecordings, deleteRecording, saveSetting, getSetting } from '../storage.js';

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

  it('saves and retrieves a recording', async () => {
    const rec = mockRec();
    await saveRecording(rec);
    const all = await getRecordings();
    const found = all.find(r => r.id === rec.id);
    expect(found).toBeTruthy();
    expect(found.title).toBe('Test Recording');
  });

  it('overwrites existing recording on re-save', async () => {
    const rec = mockRec();
    await saveRecording(rec);
    rec.title = 'Updated Title';
    await saveRecording(rec);
    const all = await getRecordings();
    const found = all.find(r => r.id === rec.id);
    expect(found.title).toBe('Updated Title');
  });

  it('deletes a recording', async () => {
    const rec = mockRec();
    await saveRecording(rec);
    await deleteRecording(rec.id);
    const all = await getRecordings();
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
