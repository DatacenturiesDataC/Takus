// Takus — Integration Payload Builder Tests
// Tests pure payload-building functions across all 5 integrations.
import { describe, it, expect, vi } from 'vitest';

// Mock task-helpers for integrations (uses isStepDone + getTaskTitle)
vi.mock('../../../lib/task-helpers.js', () => ({
  isStepDone: vi.fn((step) => step.status === 'completed'),
  getTaskTitle: vi.fn((task, fallback) => task?.title || task?.note || fallback || 'Task'),
}));

import { buildSlackPayload } from '../../integrations/slack.js';
import { buildGitHubIssuePayload } from '../../integrations/github.js';

// ── Slack ────────────────────────────────────────────────────────────────────

describe('buildSlackPayload', () => {
  it('builds a basic message', () => {
    const task = { title: 'Fix login', payload: { message: 'Login broken on mobile' } };
    const recording = { title: 'Sprint Review' };
    const result = buildSlackPayload(task, recording);

    expect(result.text).toBe('Fix login');
    expect(result.blocks).toHaveLength(2); // section + context
    expect(result.blocks[0].text.text).toContain('*Fix login*');
    expect(result.blocks[0].text.text).toContain('Login broken on mobile');
  });

  it('includes objective in message', () => {
    const task = { title: 'Task', objective: 'Ship by Friday', payload: {} };
    const result = buildSlackPayload(task, {});
    expect(result.blocks[0].text.text).toContain('Ship by Friday');
  });

  it('renders steps with checkmarks', () => {
    const task = {
      title: 'Deploy',
      payload: {},
      steps: [
        { text: 'Build', status: 'completed' },
        { text: 'Test', status: 'pending' },
        'Manual step',
      ],
    };
    const result = buildSlackPayload(task, {});
    const stepBlock = result.blocks.find(b => b.text?.text?.includes('✅'));
    expect(stepBlock).toBeDefined();
    expect(stepBlock.text.text).toContain('✅ Build');
    expect(stepBlock.text.text).toContain('⬜ Test');
    expect(stepBlock.text.text).toContain('⬜ Manual step');
  });

  it('includes Drive link when available', () => {
    const task = { title: 'T', payload: {} };
    const recording = { title: 'Meeting', driveLink: 'https://drive.google.com/file/123' };
    const result = buildSlackPayload(task, recording);
    const ctx = result.blocks.find(b => b.type === 'context');
    expect(ctx.elements[0].text).toContain('drive.google.com');
  });

  it('handles null recording gracefully', () => {
    const task = { title: 'T', payload: {} };
    const result = buildSlackPayload(task, null);
    expect(result.text).toBe('T');
    expect(result.blocks.length).toBeGreaterThanOrEqual(1);
  });
});

// ── GitHub ────────────────────────────────────────────────────────────────────

describe('buildGitHubIssuePayload', () => {
  it('builds a bug report body', () => {
    const task = {
      title: 'Login crash',
      payload: {
        steps: '1. Open app\n2. Click login',
        expected: 'Login form appears',
        actual: 'App crashes',
      },
    };
    const result = buildGitHubIssuePayload(task, {});

    expect(result.title).toBe('Login crash');
    expect(result.labels).toEqual(['bug']);
    expect(result.body).toContain('## Bug Report');
    expect(result.body).toContain('Steps to Reproduce');
    expect(result.body).toContain('**Expected:** Login form appears');
    expect(result.body).toContain('**Actual:** App crashes');
  });

  it('includes error log in code block', () => {
    const task = {
      title: 'Crash',
      payload: { error_log: 'TypeError: null ref' },
    };
    const result = buildGitHubIssuePayload(task, {});
    expect(result.body).toContain('```');
    expect(result.body).toContain('TypeError: null ref');
  });

  it('includes recording link', () => {
    const task = { title: 'Bug', payload: {} };
    const recording = { title: 'Session', driveLink: 'https://drive.google.com/file/abc' };
    const result = buildGitHubIssuePayload(task, recording);
    expect(result.body).toContain('[Recording: Session](https://drive.google.com/file/abc)');
  });

  it('renders task steps as checkboxes', () => {
    const task = {
      title: 'Multi-step',
      payload: {},
      steps: [
        { text: 'Step 1', status: 'completed' },
        { text: 'Step 2', status: 'pending' },
      ],
    };
    const result = buildGitHubIssuePayload(task, {});
    expect(result.body).toContain('- [x] Step 1');
    expect(result.body).toContain('- [ ] Step 2');
  });

  it('handles minimal task with no payload', () => {
    const task = { title: 'Simple bug', payload: {} };
    const result = buildGitHubIssuePayload(task, null);
    expect(result.title).toBe('Simple bug');
    expect(result.body).toContain('## Bug Report');
  });
});
