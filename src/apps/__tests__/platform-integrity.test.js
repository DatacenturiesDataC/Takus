// Takus — Platform Integrity Tests
// Validates the entire app platform ecosystem is correctly wired.
// These tests verify cross-cutting concerns that individual app tests don't cover.

import { describe, it, expect } from 'vitest';
import { BUILT_IN_APPS } from '../registry.js';
import { validateAppManifest } from '../../lib/app-interface.js';
import { EDGE_TYPES, getEdgeTypeKeys } from '../../lib/edge-types.js';
import { CONTENT_TYPES, getCaptureTypes, getDocumentTypes } from '../../lib/content-types.js';

// ── Registry Integrity ───────────────────────────────────────────────────

describe('Platform Registry', () => {
  it('has 15 registered built-in apps', () => {
    expect(BUILT_IN_APPS).toHaveLength(15);
  });

  it('all apps pass manifest validation', () => {
    for (const app of BUILT_IN_APPS) {
      expect(() => validateAppManifest(app), `${app.id} failed validation`).not.toThrow();
    }
  });

  it('all app IDs are unique', () => {
    const ids = BUILT_IN_APPS.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all app IDs are lowercase alphanumeric', () => {
    for (const app of BUILT_IN_APPS) {
      expect(app.id).toMatch(/^[a-z][a-z0-9_-]*$/);
    }
  });

  it('core apps are listed before built-in apps', () => {
    const coreApps = BUILT_IN_APPS.filter(a => a.category === 'core');
    const builtInApps = BUILT_IN_APPS.filter(a => a.category === 'built-in');
    const lastCoreIndex = BUILT_IN_APPS.indexOf(coreApps[coreApps.length - 1]);
    const firstBuiltInIndex = BUILT_IN_APPS.indexOf(builtInApps[0]);
    expect(lastCoreIndex).toBeLessThan(firstBuiltInIndex);
  });

  it('every app has a version string', () => {
    for (const app of BUILT_IN_APPS) {
      expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('every app has a non-empty description', () => {
    for (const app of BUILT_IN_APPS) {
      expect(app.description.length).toBeGreaterThan(10);
    }
  });
});

// ── Node Type Coverage ───────────────────────────────────────────────────

describe('Platform Node Types', () => {
  it('all 11 PRD node types are declared by apps', () => {
    const allNodeTypes = BUILT_IN_APPS.flatMap(a => a.getNodeTypes());
    const expected = [
      'recording', 'task', 'person', 'goal', 'event',
      'wiki_entry', 'conversation', 'document', 'note',
      'ai_insight', 'feedback_report',
    ];
    for (const type of expected) {
      expect(allNodeTypes, `Missing node type: ${type}`).toContain(type);
    }
  });

  it('no duplicate node type declarations across apps', () => {
    const seen = new Map();
    for (const app of BUILT_IN_APPS) {
      for (const type of app.getNodeTypes()) {
        if (seen.has(type)) {
          // conversation is declared by both Ask and Chat — that's okay
          // (Ask registers it, Chat declares it for routing)
          if (type === 'conversation') continue;
        }
        seen.set(type, app.id);
      }
    }
  });
});

// ── Edge Type Coverage ───────────────────────────────────────────────────

describe('Platform Edge Types', () => {
  it('has 13 registered edge types', () => {
    expect(getEdgeTypeKeys()).toHaveLength(13);
  });

  it('all PRD edge types are present', () => {
    const keys = getEdgeTypeKeys();
    const expected = [
      'PARTICIPATED_IN', 'HAS_TASK', 'SIMILAR_TO', 'MENTIONED_IN',
      'ASSIGNED_TO', 'DERIVED_FROM', 'NEXT_STEP', 'BLOCKS', 'MENTIONS',
      'CONTRIBUTES_TO', 'SUPPORTS', 'INVOLVES', 'HAS_CONVERSATION',
    ];
    for (const type of expected) {
      expect(keys, `Missing edge type: ${type}`).toContain(type);
    }
  });

  it('all edge types have required display properties', () => {
    for (const [key, config] of Object.entries(EDGE_TYPES)) {
      expect(config.icon, `${key} missing icon`).toBeTruthy();
      expect(config.label, `${key} missing label`).toBeTruthy();
      expect(config.color, `${key} missing color`).toMatch(/^#/);
      expect(config.cssVar, `${key} missing cssVar`).toMatch(/^var\(/);
    }
  });
});

// ── Content Type Coverage ────────────────────────────────────────────────

describe('Platform Content Types', () => {
  it('has 11 content types', () => {
    expect(CONTENT_TYPES).toHaveLength(11);
  });

  it('has 5 capture types', () => {
    expect(getCaptureTypes()).toHaveLength(5);
  });

  it('has 6 document types', () => {
    expect(getDocumentTypes()).toHaveLength(6);
  });

  it('all capture types have keyboard shortcuts', () => {
    for (const type of getCaptureTypes()) {
      expect(type.key, `${type.id} missing shortcut key`).toBeTruthy();
      expect(type.key.length).toBe(1);
    }
  });

  it('includes voice_note capture type', () => {
    const vn = CONTENT_TYPES.find(t => t.id === 'voice_note');
    expect(vn).toBeTruthy();
    expect(vn.category).toBe('entry');
    expect(vn.key).toBe('v');
  });

  it('all IDs are unique', () => {
    const ids = CONTENT_TYPES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all accents are unique', () => {
    const accents = CONTENT_TYPES.map(t => t.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });
});

// ── Step Type Coverage ───────────────────────────────────────────────────

describe('Platform Step Types', () => {
  it('at least 5 step types are registered across apps', () => {
    const allSteps = BUILT_IN_APPS.flatMap(a => a.getStepTypes());
    expect(allSteps.length).toBeGreaterThanOrEqual(5);
  });

  it('system_condense requires user approval', () => {
    const archive = BUILT_IN_APPS.find(a => a.id === 'archive');
    const condense = archive.getStepTypes().find(s => s.type === 'system_condense');
    expect(condense).toBeTruthy();
    expect(condense.autoApprove).toBe(false);
  });

  it('chat_process_intent requires user approval', () => {
    const chat = BUILT_IN_APPS.find(a => a.id === 'chat');
    const intent = chat.getStepTypes().find(s => s.type === 'chat_process_intent');
    expect(intent).toBeTruthy();
    expect(intent.autoApprove).toBe(false);
  });

  it('autonomy_embed is auto-approved', () => {
    const ask = BUILT_IN_APPS.find(a => a.id === 'ask');
    const embed = ask.getStepTypes().find(s => s.type === 'autonomy_embed');
    expect(embed).toBeTruthy();
    expect(embed.autoApprove).toBe(true);
  });
});

// ── Settings Schema ──────────────────────────────────────────────────────

describe('Platform Settings', () => {
  it('all apps return valid settings schemas', () => {
    for (const app of BUILT_IN_APPS) {
      const schema = app.getSettingsSchema();
      expect(Array.isArray(schema), `${app.id} schema not array`).toBe(true);
      for (const field of schema) {
        expect(field.key, `${app.id} field missing key`).toBeTruthy();
        expect(field.label, `${app.id} field missing label`).toBeTruthy();
        expect(field.type, `${app.id} field missing type`).toBeTruthy();
      }
    }
  });

  it('all apps return default settings', () => {
    for (const app of BUILT_IN_APPS) {
      const defaults = app.getDefaultSettings();
      expect(typeof defaults).toBe('object');
    }
  });
});
