// Takus — IndexedDB v5 Migration Dry-Run + Schema Validator Tests
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { saveContact, getContacts, getContact, deleteContact,
         saveInteraction, getInteractionsForContact, getAllInteractions,
         saveEngagementEvent, getEngagementsByContent,
         saveContentItem, getContentItems } from '../storage.js';
import { validateEntry, validateContact, validateEntries } from '../schema-validator.js';

// ─── v5 Migration Dry-Run ───────────────────────────────────────────────────

describe('IndexedDB v5 migration — contacts CRUD', () => {
  const testContact = {
    id: 'contact_1',
    name: 'Alice Johnson',
    email: 'alice@example.com',
    closenessScore: 72,
    isManualClose: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('can save and retrieve a contact', async () => {
    await saveContact(testContact);
    const contact = await getContact('contact_1');
    expect(contact).toBeTruthy();
    expect(contact.name).toBe('Alice Johnson');
    expect(contact.email).toBe('alice@example.com');
    expect(contact.closenessScore).toBe(72);
  });

  it('can list all contacts', async () => {
    await saveContact({ ...testContact, id: 'contact_2', name: 'Bob', email: 'bob@example.com' });
    const contacts = await getContacts();
    expect(contacts.length).toBeGreaterThanOrEqual(1);
  });

  it('can update a contact (upsert via put)', async () => {
    await saveContact({ ...testContact, closenessScore: 85 });
    const updated = await getContact('contact_1');
    expect(updated.closenessScore).toBe(85);
  });

  it('can delete a contact', async () => {
    await saveContact({ id: 'del_test', name: 'Delete Me', email: 'del@test.com', closenessScore: 0, isManualClose: false, createdAt: Date.now(), updatedAt: Date.now() });
    await deleteContact('del_test');
    const gone = await getContact('del_test');
    expect(gone).toBeNull();
  });
});

describe('IndexedDB v5 migration — interactions CRUD', () => {
  it('can save and retrieve interactions for a contact', async () => {
    await saveInteraction({ contactId: 'c1', type: 'meeting', timestamp: Date.now(), metadata: {} });
    await saveInteraction({ contactId: 'c1', type: 'direct_message', timestamp: Date.now(), metadata: {} });
    await saveInteraction({ contactId: 'c2', type: 'meeting', timestamp: Date.now(), metadata: {} });

    const c1 = await getInteractionsForContact('c1');
    expect(c1).toHaveLength(2);

    const all = await getAllInteractions();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });
});

describe('IndexedDB v5 migration — engagement events', () => {
  it('can save and query engagement events by content', async () => {
    await saveEngagementEvent({ contentId: 'rec_1', contactId: 'c1', type: 'comment', timestamp: Date.now() });
    await saveEngagementEvent({ contentId: 'rec_1', contactId: 'c2', type: 'view', timestamp: Date.now() });
    await saveEngagementEvent({ contentId: 'rec_2', contactId: 'c1', type: 'share', timestamp: Date.now() });

    const engagements = await getEngagementsByContent('rec_1');
    expect(engagements).toHaveLength(2);
  });
});

describe('IndexedDB v5 migration — content items', () => {
  it('can save and list content items', async () => {
    await saveContentItem({ id: 'item_1', ownerId: 'me', knowledgeLevel: 'L0', date: Date.now() });
    await saveContentItem({ id: 'item_2', ownerId: 'alice', knowledgeLevel: 'L2', date: Date.now() });

    const items = await getContentItems();
    expect(items.length).toBeGreaterThanOrEqual(2);
    const l0 = items.find(i => i.id === 'item_1');
    expect(l0.knowledgeLevel).toBe('L0');
  });
});

// ─── Schema Validator ───────────────────────────────────────────────────────

describe('validateEntry', () => {
  it('returns null for null/undefined input', () => {
    expect(validateEntry(null)).toBeNull();
    expect(validateEntry(undefined)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateEntry('string')).toBeNull();
    expect(validateEntry(42)).toBeNull();
  });

  it('returns null for missing id', () => {
    expect(validateEntry({ title: 'test' })).toBeNull();
  });

  it('fills default title', () => {
    const r = validateEntry({ id: 'r1' });
    expect(r.title).toBe('Untitled');
  });

  it('fills default type', () => {
    const r = validateEntry({ id: 'r1', type: 'invalid' });
    expect(r.type).toBe('screen');
  });

  it('preserves valid fields', () => {
    const r = validateEntry({ id: 'r1', title: 'My Rec', date: 1000, duration: 60, size: 5000, type: 'meeting' });
    expect(r.title).toBe('My Rec');
    expect(r.type).toBe('meeting');
    expect(r.date).toBe(1000);
  });

  it('coerces non-string optional fields', () => {
    const r = validateEntry({ id: 'r1', aiSummary: 123 });
    expect(r.aiSummary).toBe('123');
  });

  it('does not mutate original', () => {
    const original = { id: 'r1', title: 'Test' };
    const validated = validateEntry(original);
    validated.title = 'Changed';
    expect(original.title).toBe('Test');
  });
});

describe('validateContact', () => {
  it('returns null for missing id', () => {
    expect(validateContact({ name: 'test' })).toBeNull();
  });

  it('clamps closeness score', () => {
    const c = validateContact({ id: 'c1', closenessScore: 200 });
    expect(c.closenessScore).toBe(100);

    const c2 = validateContact({ id: 'c2', closenessScore: -10 });
    expect(c2.closenessScore).toBe(0);
  });

  it('defaults isManualClose to false', () => {
    const c = validateContact({ id: 'c1' });
    expect(c.isManualClose).toBe(false);
  });
});

describe('validateEntries (batch)', () => {
  it('filters out invalid records', () => {
    const records = [
      { id: 'r1', title: 'Good' },
      null,
      { title: 'No ID' },
      { id: 'r2', title: 'Also Good' },
    ];
    const valid = validateEntries(records);
    expect(valid).toHaveLength(2);
    expect(valid[0].id).toBe('r1');
    expect(valid[1].id).toBe('r2');
  });

  it('returns empty array for non-array', () => {
    expect(validateEntries('not an array')).toEqual([]);
  });
});
