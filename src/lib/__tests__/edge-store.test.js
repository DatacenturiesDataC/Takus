// Takus — Edge Store Tests
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addEdge,
  getEdgesFromNode,
  getEdgesToNode,
  getEdgesForNode,
  removeEdge,
  removeEdgesForNode,
} from '../storage.js';

describe('Edge Store (Knowledge Graph)', () => {
  beforeEach(async () => {
    // Clean the edges store between tests
    const edges = await getEdgesForNode('entry', 'test-rec-1');
    for (const e of edges) await removeEdge(e.id);
    const edges2 = await getEdgesForNode('contact', 'test-contact-1');
    for (const e of edges2) await removeEdge(e.id);
    const edges3 = await getEdgesForNode('entry', 'test-rec-2');
    for (const e of edges3) await removeEdge(e.id);
  });

  it('adds and retrieves an edge', async () => {
    const id = await addEdge({
      sourceType: 'entry',
      sourceId: 'test-rec-1',
      targetType: 'contact',
      targetId: 'test-contact-1',
      edgeType: 'PARTICIPATED_IN',
    });

    expect(id).toContain('PARTICIPATED_IN');

    const edges = await getEdgesFromNode('entry', 'test-rec-1');
    expect(edges.length).toBe(1);
    expect(edges[0].edgeType).toBe('PARTICIPATED_IN');
    expect(edges[0].targetId).toBe('test-contact-1');
  });

  it('retrieves edges by target', async () => {
    await addEdge({
      sourceType: 'entry',
      sourceId: 'test-rec-1',
      targetType: 'contact',
      targetId: 'test-contact-1',
      edgeType: 'PARTICIPATED_IN',
    });

    const edges = await getEdgesToNode('contact', 'test-contact-1');
    expect(edges.length).toBe(1);
    expect(edges[0].sourceId).toBe('test-rec-1');
  });

  it('getEdgesForNode returns both directions', async () => {
    await addEdge({
      sourceType: 'entry',
      sourceId: 'test-rec-1',
      targetType: 'contact',
      targetId: 'test-contact-1',
      edgeType: 'PARTICIPATED_IN',
    });
    await addEdge({
      sourceType: 'contact',
      sourceId: 'test-contact-1',
      targetType: 'entry',
      targetId: 'test-rec-1',
      edgeType: 'MENTIONED_IN',
    });

    const edges = await getEdgesForNode('entry', 'test-rec-1');
    expect(edges.length).toBe(2);
  });

  it('removes a specific edge', async () => {
    const id = await addEdge({
      sourceType: 'entry',
      sourceId: 'test-rec-1',
      targetType: 'entry',
      targetId: 'test-rec-2',
      edgeType: 'SIMILAR_TO',
      metadata: { score: 0.85 },
    });

    await removeEdge(id);
    const edges = await getEdgesFromNode('entry', 'test-rec-1');
    expect(edges.length).toBe(0);
  });

  it('removes all edges for a node', async () => {
    await addEdge({
      sourceType: 'entry',
      sourceId: 'test-rec-1',
      targetType: 'contact',
      targetId: 'test-contact-1',
      edgeType: 'PARTICIPATED_IN',
    });
    await addEdge({
      sourceType: 'entry',
      sourceId: 'test-rec-1',
      targetType: 'entry',
      targetId: 'test-rec-2',
      edgeType: 'SIMILAR_TO',
    });

    await removeEdgesForNode('entry', 'test-rec-1');
    const edges = await getEdgesForNode('entry', 'test-rec-1');
    expect(edges.length).toBe(0);
  });

  it('upserts edges by deterministic ID', async () => {
    await addEdge({
      sourceType: 'entry',
      sourceId: 'test-rec-1',
      targetType: 'contact',
      targetId: 'test-contact-1',
      edgeType: 'PARTICIPATED_IN',
    });
    // Adding the same edge again should not duplicate
    await addEdge({
      sourceType: 'entry',
      sourceId: 'test-rec-1',
      targetType: 'contact',
      targetId: 'test-contact-1',
      edgeType: 'PARTICIPATED_IN',
    });

    const edges = await getEdgesFromNode('entry', 'test-rec-1');
    expect(edges.length).toBe(1);
  });

  it('stores edge metadata', async () => {
    await addEdge({
      sourceType: 'entry',
      sourceId: 'test-rec-1',
      targetType: 'entry',
      targetId: 'test-rec-2',
      edgeType: 'SIMILAR_TO',
      metadata: { score: 0.92, method: 'cosine' },
    });

    const edges = await getEdgesFromNode('entry', 'test-rec-1');
    expect(edges[0].metadata.score).toBe(0.92);
    expect(edges[0].metadata.method).toBe('cosine');
  });
});
