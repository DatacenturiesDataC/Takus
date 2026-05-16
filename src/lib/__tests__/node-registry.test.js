// Takus — Node Registry Tests
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerNodeType, registerNodeTypes, unregisterAppNodeTypes,
  getNodeType, getAllNodeTypes, getNodeTypesForApp, hasNodeType,
  validateNode, createNode, _resetForTest,
} from '../graph/node-registry.js';

describe('Node Registry', () => {
  beforeEach(() => {
    _resetForTest();
  });

  describe('registration', () => {
    it('registers a node type', () => {
      registerNodeType({
        type: 'recording',
        label: 'Recording',
        icon: '🎬',
        appId: 'recorder',
      });
      expect(hasNodeType('recording')).toBe(true);
      expect(getNodeType('recording').label).toBe('Recording');
    });

    it('throws if type key is missing', () => {
      expect(() => registerNodeType({})).toThrow('requires a "type" key');
    });

    it('throws if different app tries to register same type', () => {
      registerNodeType({ type: 'task', appId: 'tasks-app' });
      expect(() => registerNodeType({ type: 'task', appId: 'other-app' })).toThrow('already registered');
    });

    it('allows same app to re-register its own type', () => {
      registerNodeType({ type: 'task', appId: 'tasks-app', label: 'v1' });
      registerNodeType({ type: 'task', appId: 'tasks-app', label: 'v2' });
      expect(getNodeType('task').label).toBe('v2');
    });

    it('registers multiple types', () => {
      registerNodeTypes([
        { type: 'person', appId: 'people' },
        { type: 'event', appId: 'calendar' },
      ]);
      expect(getAllNodeTypes()).toHaveLength(2);
    });

    it('fills in defaults for optional fields', () => {
      registerNodeType({ type: 'minimal', appId: 'test' });
      const def = getNodeType('minimal');
      expect(def.icon).toBe('📄');
      expect(def.label).toBe('minimal');
      expect(def.requiredProps).toEqual([]);
    });
  });

  describe('unregistration', () => {
    it('removes all types for a given appId', () => {
      registerNodeTypes([
        { type: 'a', appId: 'app1' },
        { type: 'b', appId: 'app1' },
        { type: 'c', appId: 'app2' },
      ]);
      unregisterAppNodeTypes('app1');
      expect(getAllNodeTypes()).toHaveLength(1);
      expect(hasNodeType('c')).toBe(true);
    });
  });

  describe('queries', () => {
    it('returns null for unknown types', () => {
      expect(getNodeType('ghost')).toBeNull();
    });

    it('filters by appId', () => {
      registerNodeTypes([
        { type: 'a', appId: 'recorder' },
        { type: 'b', appId: 'recorder' },
        { type: 'c', appId: 'people' },
      ]);
      expect(getNodeTypesForApp('recorder')).toHaveLength(2);
      expect(getNodeTypesForApp('people')).toHaveLength(1);
    });
  });

  describe('validateNode', () => {
    it('rejects null', () => {
      expect(validateNode(null).valid).toBe(false);
    });

    it('rejects missing id', () => {
      expect(validateNode({ type: 'x' }).valid).toBe(false);
    });

    it('rejects missing type', () => {
      expect(validateNode({ id: '123' }).valid).toBe(false);
    });

    it('accepts unknown types gracefully', () => {
      const result = validateNode({ id: '1', type: 'custom_thing' });
      expect(result.valid).toBe(true);
    });

    it('checks required properties', () => {
      registerNodeType({
        type: 'recording',
        appId: 'recorder',
        requiredProps: ['title', 'duration'],
      });

      const missing = validateNode({ id: '1', type: 'recording', properties: { title: 'x' } });
      expect(missing.valid).toBe(false);
      expect(missing.error).toContain('duration');

      const ok = validateNode({ id: '1', type: 'recording', properties: { title: 'x', duration: 10 } });
      expect(ok.valid).toBe(true);
    });

    it('runs custom validator', () => {
      registerNodeType({
        type: 'strict',
        appId: 'test',
        validate: (node) => node.properties?.value > 0 ? node : null,
      });

      expect(validateNode({ id: '1', type: 'strict', properties: { value: 5 } }).valid).toBe(true);
      expect(validateNode({ id: '1', type: 'strict', properties: { value: -1 } }).valid).toBe(false);
    });

    it('handles validator errors gracefully', () => {
      registerNodeType({
        type: 'broken',
        appId: 'test',
        validate: () => { throw new Error('boom'); },
      });

      const result = validateNode({ id: '1', type: 'broken' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('boom');
    });
  });

  describe('createNode', () => {
    it('creates a node with standard fields', () => {
      registerNodeType({ type: 'task', appId: 'tasks' });
      const node = createNode('task', { title: 'Fix bug' });
      expect(node.id).toMatch(/^task_/);
      expect(node.type).toBe('task');
      expect(node.state).toBe('active');
      expect(node.appId).toBe('tasks');
      expect(node.properties.title).toBe('Fix bug');
      expect(node.createdAt).toBeTypeOf('number');
      expect(node.updatedAt).toBeTypeOf('number');
    });

    it('uses custom id when provided', () => {
      const node = createNode('note', {}, { id: 'custom-123' });
      expect(node.id).toBe('custom-123');
    });

    it('uses custom state when provided', () => {
      const node = createNode('recording', {}, { state: 'raw' });
      expect(node.state).toBe('raw');
    });

    it('defaults appId to "unknown" for unregistered types', () => {
      const node = createNode('mystery', { data: 1 });
      expect(node.appId).toBe('unknown');
    });
  });
});
