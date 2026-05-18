// Takus — Status Cards Unit Tests
import { describe, it, expect, vi } from 'vitest';
import { wellbeingCard } from '../../components/insights-cards/status-cards.js';

// wellbeingCard now accepts (entries, allTasks) — tasks come from graph store

describe('wellbeingCard', () => {
  it('renders a wellbeing card with focus gauge', async () => {
    const entries = [
      {
        id: 'r1', title: 'Standup', date: Date.now() - 60000, duration: 30000,
        size: 512, type: 'meeting',
      },
    ];
    const html = await wellbeingCard(entries, []);
    expect(html).toContain('Wellbeing');
    expect(html).toContain('Focus Capacity');
    expect(html).toContain('Session');
    expect(html).toContain('Pending Tasks');
  });

  it('returns empty for empty entries', async () => {
    const html = await wellbeingCard([], []);
    // Should still render (0 tasks, 0 meetings)
    expect(html).toContain('Wellbeing');
    expect(html).toContain('0');
  });

  it('shows task overload suggestion when >15 pending tasks', async () => {
    const manyTasks = Array.from({ length: 16 }, (_, i) => ({
      id: `t${i}`, title: `Task ${i}`, action: 'DO_TASK', status: 'pending',
    }));
    const entries = [{
      id: 'r1', title: 'Review', date: Date.now(), duration: 60000,
      size: 1024, type: 'screen',
    }];
    const html = await wellbeingCard(entries, manyTasks);
    expect(html).toContain('High task load');
  });

  it('shows meeting fatigue suggestion for 3+ recent meetings', async () => {
    const recentMeetings = Array.from({ length: 3 }, (_, i) => ({
      id: `m${i}`, title: `Meeting ${i}`, date: Date.now() - i * 30000,
      duration: 30000, size: 512, type: 'meeting',
    }));
    const html = await wellbeingCard(recentMeetings, []);
    expect(html).toContain('Meeting fatigue');
  });

  it('shows positive message when no suggestions', async () => {
    const entries = [{
      id: 'r1', title: 'Quick Screen', date: Date.now() - 86400000,
      duration: 10000, size: 256, type: 'screen',
    }];
    const html = await wellbeingCard(entries, []);
    expect(html).toContain('good shape');
  });

  it('handles entries without tasks gracefully', async () => {
    const entries = [{
      id: 'r1', title: 'No Tasks', date: Date.now(), duration: 60000,
      size: 1024, type: 'screen',
    }];
    const html = await wellbeingCard(entries);
    expect(html).toContain('Wellbeing');
    expect(html).toContain('0'); // 0 pending tasks
  });
});
