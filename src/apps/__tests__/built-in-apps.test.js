// Takus — Built-in Apps Tests
// Validates the app contracts for all registered built-in apps.
import { describe, it, expect, vi } from 'vitest';
import { validateAppManifest } from '../../lib/app-interface.js';
import { RecorderApp } from '../recorder/index.js';
import { DriveApp } from '../drive/index.js';

// ── Recorder App ──────────────────────────────────────────────────────────

describe('RecorderApp', () => {
  it('passes manifest validation', () => {
    expect(() => validateAppManifest(RecorderApp)).not.toThrow();
  });

  it('has correct identity', () => {
    expect(RecorderApp.id).toBe('recorder');
    expect(RecorderApp.category).toBe('core');
    expect(RecorderApp.icon).toBe('🎬');
  });

  it('contributes Record quick action', () => {
    const actions = RecorderApp.getQuickActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe('record');
    expect(actions[0].primary).toBe(true);
    expect(actions[0].order).toBe(1);
    expect(typeof actions[0].handler).toBe('function');
  });

  it('contributes 4 auto-run presets', () => {
    const presets = RecorderApp.getAutoRunPresets();
    expect(presets).toHaveLength(4);
    expect(presets.every(p => p.field && p.operator && p.value)).toBe(true);
    expect(presets.every(p => p.description)).toBe(true);
    expect(presets.map(p => p.field)).toEqual(['type', 'type', 'title', 'source']);
  });

  it('has renderConfigPanel method', () => {
    expect(typeof RecorderApp.renderConfigPanel).toBe('function');
  });

  it('can produce inbox items', () => {
    expect(RecorderApp.canProduceInboxItems).toBe(true);
  });

  it('defines node types (registered during activation)', () => {
    // Node types are registered during activate(), getNodeTypes() returns
    // the static definitions. The recorder registers 'entry' type.
    const nodeTypes = RecorderApp.getNodeTypes();
    // getNodeTypes returns empty by default — the actual registration
    // happens via registerNodeType() in activate(). We verify the method exists.
    expect(Array.isArray(nodeTypes)).toBe(true);
  });
});

// ── Drive App ─────────────────────────────────────────────────────────────

describe('DriveApp', () => {
  it('passes manifest validation', () => {
    expect(() => validateAppManifest(DriveApp)).not.toThrow();
  });

  it('has correct identity', () => {
    expect(DriveApp.id).toBe('drive');
    expect(DriveApp.category).toBe('built-in');
    expect(DriveApp.icon).toBe('☁️');
  });

  it('contributes Upload quick action', () => {
    const actions = DriveApp.getQuickActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe('upload');
    expect(actions[0].primary).toBe(false);
    expect(actions[0].order).toBe(10);
    expect(typeof actions[0].handler).toBe('function');
  });

  it('has _pickAndValidateFile method', () => {
    expect(typeof DriveApp._pickAndValidateFile).toBe('function');
  });

  it('does not produce inbox items', () => {
    expect(DriveApp.canProduceInboxItems).toBe(false);
  });

  it('does not contribute a config panel', () => {
    expect(DriveApp.renderConfigPanel).toBeNull();
  });

  it('has no nav item (accessed via Settings)', () => {
    expect(DriveApp.getNavItem()).toBeNull();
  });

  it('has settings schema with provider field', () => {
    const schema = DriveApp.getSettingsSchema();
    expect(schema).toHaveLength(1);
    expect(schema[0].key).toBe('provider');
    expect(schema[0].options).toHaveLength(3); // None, Google, Microsoft
  });
});

// ── Inbox App ─────────────────────────────────────────────────────────────

import { InboxApp } from '../inbox/index.js';

describe('InboxApp', () => {
  it('passes manifest validation', () => {
    expect(() => validateAppManifest(InboxApp)).not.toThrow();
  });

  it('has correct identity', () => {
    expect(InboxApp.id).toBe('inbox');
    expect(InboxApp.category).toBe('core');
    expect(InboxApp.icon).toBe('📥');
  });

  it('contributes a nav item with badge', () => {
    const nav = InboxApp.getNavItem();
    expect(nav).not.toBeNull();
    expect(nav.id).toBe('inbox');
    expect(nav.label).toBe('Inbox');
    expect(nav.order).toBe(5); // Before History
    expect(typeof nav.getBadgeCount).toBe('function');
    expect(nav.getBadgeCount()).toBe(0); // No items before activation
  });

  it('has no quick actions', () => {
    expect(InboxApp.getQuickActions()).toEqual([]);
  });

  it('does not produce inbox items', () => {
    expect(InboxApp.canProduceInboxItems).toBe(false);
  });

  it('has no config panel', () => {
    expect(InboxApp.renderConfigPanel).toBeNull();
  });

  it('has renderPanel method', () => {
    expect(typeof InboxApp.renderPanel).toBe('function');
  });
});

// ── Auto-Run Presets ────────────────────────────────────────

import { CalendarApp } from '../calendar/index.js';
import { IntegrationsApp } from '../integrations/index.js';
import { TasksApp } from '../tasks/index.js';

describe('App-contributed Auto-Run Presets', () => {
  it('DriveApp contributes 1 preset', () => {
    const presets = DriveApp.getAutoRunPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0].field).toBe('source');
    expect(presets[0].label).toContain('uploaded');
  });

  it('CalendarApp contributes 2 presets', () => {
    const presets = CalendarApp.getAutoRunPresets();
    expect(presets).toHaveLength(2);
    expect(presets.every(p => p.field && p.operator && p.value && p.label)).toBe(true);
  });

  it('IntegrationsApp contributes 3 presets', () => {
    const presets = IntegrationsApp.getAutoRunPresets();
    expect(presets).toHaveLength(3);
    expect(presets[0].label).toContain('Slack');
    expect(presets[1].label).toContain('Slack');
    expect(presets[2].label).toContain('email');
  });

  it('TasksApp contributes 2 presets', () => {
    const presets = TasksApp.getAutoRunPresets();
    expect(presets).toHaveLength(2);
    expect(presets[0].label).toContain('standup');
    expect(presets[1].label).toContain('bug');
  });

  it('total platform presets ≥ 10', () => {
    const allPresets = [
      ...RecorderApp.getAutoRunPresets(),
      ...DriveApp.getAutoRunPresets(),
      ...CalendarApp.getAutoRunPresets(),
      ...IntegrationsApp.getAutoRunPresets(),
      ...TasksApp.getAutoRunPresets(),
    ];
    expect(allPresets.length).toBeGreaterThanOrEqual(10);
    // All presets must have required fields
    for (const p of allPresets) {
      expect(p.field).toBeTruthy();
      expect(p.operator).toBeTruthy();
      expect(p.label).toBeTruthy();
    }
  });
});

// ── Archive App ──────────────────────────────────────────────────────────

import { ArchiveApp } from '../archive/index.js';

describe('ArchiveApp', () => {
  it('passes manifest validation', () => {
    expect(() => validateAppManifest(ArchiveApp)).not.toThrow();
  });

  it('has correct identity', () => {
    expect(ArchiveApp.id).toBe('archive');
    expect(ArchiveApp.category).toBe('built-in');
    expect(ArchiveApp.icon).toBe('🗄️');
  });

  it('has no nav item (accessed via Settings)', () => {
    expect(ArchiveApp.getNavItem()).toBeNull();
  });

  it('has settings schema with archiveAfterDays and graceWindowDays', () => {
    const schema = ArchiveApp.getSettingsSchema();
    expect(schema.length).toBeGreaterThanOrEqual(2);
    expect(schema.find(s => s.key === 'archiveAfterDays')).toBeTruthy();
    expect(schema.find(s => s.key === 'graceWindowDays')).toBeTruthy();
  });

  it('registers system_condense step type', () => {
    const steps = ArchiveApp.getStepTypes();
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe('system_condense');
    expect(steps[0].autoApprove).toBe(false); // Always requires confirmation
  });

  it('does not contribute node types (uses entry states)', () => {
    expect(ArchiveApp.getNodeTypes()).toEqual([]);
  });
});

// ── Documents App ────────────────────────────────────────────────────────

import { DocumentsApp } from '../documents/index.js';

describe('DocumentsApp', () => {
  it('passes manifest validation', () => {
    expect(() => validateAppManifest(DocumentsApp)).not.toThrow();
  });

  it('has correct identity', () => {
    expect(DocumentsApp.id).toBe('documents');
    expect(DocumentsApp.category).toBe('built-in');
    expect(DocumentsApp.icon).toBe('📄');
  });

  it('declares document and note node types', () => {
    const types = DocumentsApp.getNodeTypes();
    expect(types).toContain('document');
    expect(types).toContain('note');
  });

  it('declares DERIVED_FROM edge type', () => {
    expect(DocumentsApp.getEdgeTypes()).toContain('DERIVED_FROM');
  });

  it('can produce inbox items', () => {
    expect(DocumentsApp.canProduceInboxItems).toBe(true);
  });

  it('has upload quick action', () => {
    const actions = DocumentsApp.getQuickActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe('upload-doc');
  });

  it('has no nav item', () => {
    expect(DocumentsApp.getNavItem()).toBeNull();
  });
});

// ── Feedback App ─────────────────────────────────────────────────────────

import { FeedbackApp } from '../feedback/index.js';

describe('FeedbackApp', () => {
  it('passes manifest validation', () => {
    expect(() => validateAppManifest(FeedbackApp)).not.toThrow();
  });

  it('has correct identity', () => {
    expect(FeedbackApp.id).toBe('feedback');
    expect(FeedbackApp.category).toBe('built-in');
    expect(FeedbackApp.icon).toBe('💬');
  });

  it('declares feedback_report node type', () => {
    expect(FeedbackApp.getNodeTypes()).toContain('feedback_report');
  });

  it('has no nav item (floating button)', () => {
    expect(FeedbackApp.getNavItem()).toBeNull();
  });

  it('has settings with autoDetectRegressions', () => {
    const schema = FeedbackApp.getSettingsSchema();
    expect(schema.find(s => s.key === 'autoDetectRegressions')).toBeTruthy();
  });

  it('has renderPanel method', () => {
    expect(typeof FeedbackApp.renderPanel).toBe('function');
  });
});
