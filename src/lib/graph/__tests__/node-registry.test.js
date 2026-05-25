// Takus — Node Registry Tests
import { describe, it, expect, beforeEach } from 'vitest';

import {
  registerNodeType,
  registerNodeTypes,
  unregisterAppNodeTypes,
  getNodeType,
  getAllNodeTypes,
  getNodeTypesForApp,
  hasNodeType,
  validateNode,
  createNode,
  _resetForTest,
} from '../node-registry.js';

describe('Node Registry', () => {
  beforeEach(() => {
    _resetForTest();
  });

  // ── registerNodeType ────────────────────────────────────────────────────

  describe('registerNodeType', () => {
    it('registers a node type with all fields', () => {
      registerNodeType({
        type: 'person',
        label: 'Person',
        icon: '👤',
        appId: 'contacts',
        requiredProps: ['name'],
      });

      const def = getNodeType('person');
      expect(def).not.toBeNull();
      expect(def.type).toBe('person');
      expect(def.label).toBe('Person');
      expect(def.icon).toBe('👤');
      expect(def.appId).toBe('contacts');
      expect(def.requiredProps).toEqual(['name']);
    });

    it('applies defaults for optional fields', () => {
      registerNodeType({ type: 'widget', appId: 'myApp' });

      const def = getNodeType('widget');
      expect(def.label).toBe('widget');   // defaults to type key
      expect(def.icon).toBe('📄');
      expect(def.requiredProps).toEqual([]);
      expect(def.validate).toBeNull();
    });

    it('throws when type key is missing', () => {
      expect(() => registerNodeType({})).toThrow('requires a "type" key');
      expect(() => registerNodeType(null)).toThrow('requires a "type" key');
      expect(() => registerNodeType({ label: 'No type' })).toThrow('requires a "type" key');
    });

    it('throws when type is already registered by a different app', () => {
      registerNodeType({ type: 'shared', appId: 'appA' });
      expect(() => registerNodeType({ type: 'shared', appId: 'appB' }))
        .toThrow('already registered by app "appA"');
    });

    it('allows re-registration by the same app (idempotent)', () => {
      registerNodeType({ type: 'entry', appId: 'core', label: 'Entry v1' });
      registerNodeType({ type: 'entry', appId: 'core', label: 'Entry v2' });

      const def = getNodeType('entry');
      expect(def.label).toBe('Entry v2'); // updated
    });

    it('stores custom validator function', () => {
      const validator = (node) => node;
      registerNodeType({ type: 'validated', appId: 'test', validate: validator });

      const def = getNodeType('validated');
      expect(def.validate).toBe(validator);
    });
  });

  // ── registerNodeTypes (batch) ─────────────────────────────────────────────

  describe('registerNodeTypes', () => {
    it('registers multiple types at once', () => {
      registerNodeTypes([
        { type: 'entry', appId: 'core' },
        { type: 'task', appId: 'tasks' },
        { type: 'person', appId: 'contacts' },
      ]);

      expect(hasNodeType('entry')).toBe(true);
      expect(hasNodeType('task')).toBe(true);
      expect(hasNodeType('person')).toBe(true);
    });
  });

  // ── unregisterAppNodeTypes ────────────────────────────────────────────────

  describe('unregisterAppNodeTypes', () => {
    it('removes all types for a specific app', () => {
      registerNodeTypes([
        { type: 'note', appId: 'notes' },
        { type: 'tag', appId: 'notes' },
        { type: 'task', appId: 'tasks' },
      ]);

      unregisterAppNodeTypes('notes');

      expect(hasNodeType('note')).toBe(false);
      expect(hasNodeType('tag')).toBe(false);
      expect(hasNodeType('task')).toBe(true); // different app — untouched
    });

    it('does nothing when appId has no registered types', () => {
      registerNodeType({ type: 'entry', appId: 'core' });
      unregisterAppNodeTypes('nonexistent');
      expect(getAllNodeTypes()).toHaveLength(1);
    });
  });

  // ── Queries ───────────────────────────────────────────────────────────────

  describe('getNodeType', () => {
    it('returns null for unregistered type', () => {
      expect(getNodeType('unknown')).toBeNull();
    });
  });

  describe('getAllNodeTypes', () => {
    it('returns all registered types as an array', () => {
      registerNodeTypes([
        { type: 'a', appId: 'x' },
        { type: 'b', appId: 'y' },
      ]);

      const all = getAllNodeTypes();
      expect(all).toHaveLength(2);
      expect(all.map(t => t.type)).toContain('a');
      expect(all.map(t => t.type)).toContain('b');
    });

    it('returns empty array when nothing is registered', () => {
      expect(getAllNodeTypes()).toEqual([]);
    });
  });

  describe('getNodeTypesForApp', () => {
    it('filters types by appId', () => {
      registerNodeTypes([
        { type: 'entry', appId: 'core' },
        { type: 'setting', appId: 'core' },
        { type: 'task', appId: 'tasks' },
      ]);

      const coreTypes = getNodeTypesForApp('core');
      expect(coreTypes).toHaveLength(2);
      expect(coreTypes.map(t => t.type)).toEqual(['entry', 'setting']);
    });
  });

  describe('hasNodeType', () => {
    it('returns true for registered types', () => {
      registerNodeType({ type: 'entry', appId: 'core' });
      expect(hasNodeType('entry')).toBe(true);
    });

    it('returns false for unregistered types', () => {
      expect(hasNodeType('unicorn')).toBe(false);
    });
  });

  // ── validateNode ──────────────────────────────────────────────────────────

  describe('validateNode', () => {
    it('rejects null/non-object inputs', () => {
      expect(validateNode(null).valid).toBe(false);
      expect(validateNode(undefined).valid).toBe(false);
      expect(validateNode('string').valid).toBe(false);
      expect(validateNode(42).valid).toBe(false);
    });

    it('rejects node without id', () => {
      const result = validateNode({ type: 'entry' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('"id"');
    });

    it('rejects node without type', () => {
      const result = validateNode({ id: 'node_1' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('"type"');
    });

    it('allows unknown types (extensibility)', () => {
      const result = validateNode({ id: 'node_1', type: 'custom_widget' });
      expect(result.valid).toBe(true);
      expect(result.node).toEqual({ id: 'node_1', type: 'custom_widget' });
    });

    it('validates required properties are present', () => {
      registerNodeType({ type: 'person', appId: 'contacts', requiredProps: ['name', 'email'] });

      // Missing required props
      const fail = validateNode({ id: 'p1', type: 'person', properties: { name: 'Alice' } });
      expect(fail.valid).toBe(false);
      expect(fail.error).toContain('email');

      // All required props present
      const pass = validateNode({
        id: 'p2',
        type: 'person',
        properties: { name: 'Bob', email: 'bob@test.com' },
      });
      expect(pass.valid).toBe(true);
    });

    it('checks required props on both node root and properties', () => {
      registerNodeType({ type: 'hybrid', appId: 'test', requiredProps: ['name'] });

      // name on root level
      const result = validateNode({ id: 'h1', type: 'hybrid', name: 'Root-level', properties: {} });
      expect(result.valid).toBe(true);

      // name in properties
      const result2 = validateNode({ id: 'h2', type: 'hybrid', properties: { name: 'Props-level' } });
      expect(result2.valid).toBe(true);
    });

    it('runs custom validator and returns cleaned node', () => {
      registerNodeType({
        type: 'clean',
        appId: 'test',
        validate: (node) => ({ ...node, cleaned: true }),
      });

      const result = validateNode({ id: 'c1', type: 'clean' });
      expect(result.valid).toBe(true);
      expect(result.node.cleaned).toBe(true);
    });

    it('rejects when custom validator returns null', () => {
      registerNodeType({
        type: 'strict',
        appId: 'test',
        validate: () => null,
      });

      const result = validateNode({ id: 's1', type: 'strict' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('rejected');
    });

    it('rejects when custom validator returns false', () => {
      registerNodeType({
        type: 'strict2',
        appId: 'test',
        validate: () => false,
      });

      const result = validateNode({ id: 's2', type: 'strict2' });
      expect(result.valid).toBe(false);
    });

    it('handles custom validator that throws', () => {
      registerNodeType({
        type: 'broken',
        appId: 'test',
        validate: () => { throw new Error('Boom'); },
      });

      const result = validateNode({ id: 'b1', type: 'broken' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Boom');
    });

    it('returns original node when validator returns non-object truthy', () => {
      registerNodeType({
        type: 'passthrough',
        appId: 'test',
        validate: () => true,
      });

      const original = { id: 'pt1', type: 'passthrough' };
      const result = validateNode(original);
      expect(result.valid).toBe(true);
      expect(result.node).toBe(original);
    });
  });

  // ── createNode ────────────────────────────────────────────────────────────

  describe('createNode', () => {
    it('creates a node with standard fields', () => {
      const node = createNode('task', { title: 'My Task' });

      expect(node.id).toMatch(/^task_/);
      expect(node.type).toBe('task');
      expect(node.state).toBe('active');
      expect(node.appId).toBe('unknown');
      expect(node.properties).toEqual({ title: 'My Task' });
      expect(node.createdAt).toBeTypeOf('number');
      expect(node.updatedAt).toBeTypeOf('number');
    });

    it('uses registered type appId when available', () => {
      registerNodeType({ type: 'entry', appId: 'core' });
      const node = createNode('entry', { summary: 'test' });
      expect(node.appId).toBe('core');
    });

    it('allows custom id via options', () => {
      const node = createNode('task', {}, { id: 'custom_id_42' });
      expect(node.id).toBe('custom_id_42');
    });

    it('allows custom state via options', () => {
      const node = createNode('task', {}, { state: 'archived' });
      expect(node.state).toBe('archived');
    });

    it('allows custom appId via options (overrides type def)', () => {
      registerNodeType({ type: 'entry', appId: 'core' });
      const node = createNode('entry', {}, { appId: 'custom_app' });
      expect(node.appId).toBe('custom_app');
    });

    it('creates independent copies of properties', () => {
      const props = { title: 'Original' };
      const node = createNode('task', props);
      props.title = 'Mutated';
      expect(node.properties.title).toBe('Original');
    });

    it('works for unregistered types', () => {
      const node = createNode('custom_widget', { color: 'blue' });
      expect(node.type).toBe('custom_widget');
      expect(node.appId).toBe('unknown');
      expect(node.properties.color).toBe('blue');
    });
  });

  // ── _resetForTest ─────────────────────────────────────────────────────────

  describe('_resetForTest', () => {
    it('clears all registered types', () => {
      registerNodeTypes([
        { type: 'a', appId: 'x' },
        { type: 'b', appId: 'y' },
      ]);
      expect(getAllNodeTypes()).toHaveLength(2);

      _resetForTest();
      expect(getAllNodeTypes()).toHaveLength(0);
    });
  });
});
