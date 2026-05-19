
// Unit tests for chat command parsing and task extraction patterns.
// Tests the regex patterns used in ask-panel.js for extracting tasks/notes.
import { describe, it, expect } from 'vitest';

// ── Command Parsing ─────────────────────────────────────────────────────────

function parseCommand(text) {
  const lower = text.toLowerCase().trim();

  if (lower.startsWith('create a task:') || lower.startsWith('add task:') || lower.startsWith('todo:')) {
    const title = text.replace(/^(create a task:|add task:|todo:)\s*/i, '').trim();
    return title ? { type: 'task', title } : null;
  }
  if (lower.startsWith('save a note:') || lower.startsWith('note:')) {
    const content = text.replace(/^(save a note:|note:)\s*/i, '').trim();
    return content ? { type: 'note', content } : null;
  }
  return null;
}

describe('Chat Command Parsing', () => {
  describe('Task commands', () => {
    it('parses "Create a task: ..."', () => {
      const r = parseCommand('Create a task: Review Q3 metrics');
      expect(r).toEqual({ type: 'task', title: 'Review Q3 metrics' });
    });

    it('parses "Add task: ..."', () => {
      const r = parseCommand('Add task: Fix login bug');
      expect(r).toEqual({ type: 'task', title: 'Fix login bug' });
    });

    it('parses "TODO: ..." (case-insensitive)', () => {
      const r = parseCommand('todo: Deploy staging build');
      expect(r).toEqual({ type: 'task', title: 'Deploy staging build' });
    });

    it('returns null for empty task', () => {
      expect(parseCommand('Create a task:   ')).toBe(null);
    });

    it('preserves original casing in title', () => {
      const r = parseCommand('create a task: Schedule Meeting With CEO');
      expect(r.title).toBe('Schedule Meeting With CEO');
    });
  });

  describe('Note commands', () => {
    it('parses "Save a note: ..."', () => {
      const r = parseCommand('Save a note: Design team discussed new UI');
      expect(r).toEqual({ type: 'note', content: 'Design team discussed new UI' });
    });

    it('parses "Note: ..."', () => {
      const r = parseCommand('Note: Remember to update docs');
      expect(r).toEqual({ type: 'note', content: 'Remember to update docs' });
    });

    it('returns null for empty note', () => {
      expect(parseCommand('Note:  ')).toBe(null);
    });
  });

  describe('Non-commands', () => {
    it('returns null for regular questions', () => {
      expect(parseCommand('What did we discuss last week?')).toBe(null);
    });

    it('returns null for empty string', () => {
      expect(parseCommand('')).toBe(null);
    });

    it('returns null for text containing "task" mid-sentence', () => {
      expect(parseCommand('Can you show me the task list?')).toBe(null);
    });
  });
});

// ── Task Extraction from AI Responses ───────────────────────────────────────

function extractTasks(response) {
  if (!response || response.length < 30) return [];

  const patterns = [
    /^[-*]\s*\[[ ]\]\s*(.+)$/gm,
    /^(?:action|todo|task|follow.?up)\s*[:：]\s*(.+)$/gim,
    /^\d+\.\s*\*\*(?:Action|Task|Follow.?up)\*\*\s*[:：]?\s*(.+)$/gm,
  ];

  const tasks = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const title = match[1].replace(/\*\*/g, '').trim();
      if (title.length >= 5 && title.length <= 200) {
        tasks.push(title);
      }
    }
  }

  return [...new Set(tasks)].slice(0, 5);
}

describe('Task Extraction from AI Responses', () => {
  it('extracts markdown checkbox items', () => {
    const response = `Here are some things to do:

- [ ] Review the quarterly metrics dashboard
- [ ] Schedule a follow-up meeting with the team
- [x] Already completed this item`;

    const tasks = extractTasks(response);
    expect(tasks).toEqual([
      'Review the quarterly metrics dashboard',
      'Schedule a follow-up meeting with the team',
    ]);
  });

  it('extracts "Action:" prefix items', () => {
    const response = `Based on our analysis, I recommend:

Action: Update the API documentation with the new endpoints
Follow-up: Schedule review session with stakeholders`;

    const tasks = extractTasks(response);
    expect(tasks).toContain('Update the API documentation with the new endpoints');
    expect(tasks).toContain('Schedule review session with stakeholders');
  });

  it('extracts numbered bold action items', () => {
    const response = `Key takeaways from the discussion:

1. **Action**: Review the budget allocation for Q4
2. **Task**: Create a project timeline for the redesign
3. **Follow-up**: Check in with the marketing team`;

    const tasks = extractTasks(response);
    expect(tasks.length).toBe(3);
    expect(tasks[0]).toContain('Review the budget allocation for Q4');
  });

  it('returns empty for short responses', () => {
    expect(extractTasks('Sure, I can help!')).toEqual([]);
  });

  it('returns empty for responses without action items', () => {
    const response = `The weather in San Francisco is typically foggy in the morning and clears up by afternoon. The average temperature ranges from 55-65°F.`;
    expect(extractTasks(response)).toEqual([]);
  });

  it('deduplicates identical tasks', () => {
    const response = `Here are the action items:

- [ ] Deploy the staging build
Action: Deploy the staging build`;

    const tasks = extractTasks(response);
    expect(tasks).toEqual(['Deploy the staging build']);
  });

  it('caps at 5 tasks maximum', () => {
    const lines = Array.from({ length: 8 }, (_, i) =>
      `- [ ] Task number ${i + 1} that needs to be completed`
    ).join('\n');
    const tasks = extractTasks(`Some context:\n${lines}`);
    expect(tasks.length).toBeLessThanOrEqual(5);
  });

  it('filters tasks shorter than 5 chars', () => {
    const response = `Things to do:
- [ ] Yes
- [ ] Review the entire codebase for issues`;
    const tasks = extractTasks(response);
    expect(tasks).toEqual(['Review the entire codebase for issues']);
  });

  it('handles "TODO:" prefix', () => {
    const response = `Some notes from the meeting.

TODO: Update the deployment pipeline configuration`;
    const tasks = extractTasks(response);
    expect(tasks).toContain('Update the deployment pipeline configuration');
  });
});
