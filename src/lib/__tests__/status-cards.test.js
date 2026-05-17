// Takus — Status Cards Unit Tests
import { describe, it, expect, vi } from 'vitest';
import { wellbeingCard } from '../../components/insights-cards/status-cards.js';

// wellbeingCard is the only synchronous status card (no external service calls)
// The async cards (healthCard, archiveStatsCard, etc.) require service mocks

describe('wellbeingCard', () => {
  it('renders a wellbeing card with focus gauge', () => {
    const recordings = [
      {
        id: 'r1', title: 'Standup', date: Date.now() - 60000, duration: 30000,
        size: 512, type: 'meeting',
        tasks: { takusTasks: [], meTasks: [] },
      },
    ];
    const html = wellbeingCard(recordings);
    expect(html).toContain('Wellbeing');
    expect(html).toContain('Focus Capacity');
    expect(html).toContain('Session');
    expect(html).toContain('Pending Tasks');
  });

  it('returns empty for empty recordings', () => {
    const html = wellbeingCard([]);
    // Should still render (0 tasks, 0 meetings)
    expect(html).toContain('Wellbeing');
    expect(html).toContain('0');
  });

  it('shows task overload suggestion when >15 pending tasks', () => {
    const manyTasks = Array.from({ length: 16 }, (_, i) => ({
      title: `Task ${i}`, action: 'DO_TASK', status: 'pending',
    }));
    const recordings = [{
      id: 'r1', title: 'Review', date: Date.now(), duration: 60000,
      size: 1024, type: 'screen',
      tasks: { takusTasks: [], meTasks: manyTasks },
    }];
    const html = wellbeingCard(recordings);
    expect(html).toContain('High task load');
  });

  it('shows meeting fatigue suggestion for 3+ recent meetings', () => {
    const recentMeetings = Array.from({ length: 3 }, (_, i) => ({
      id: `m${i}`, title: `Meeting ${i}`, date: Date.now() - i * 30000,
      duration: 30000, size: 512, type: 'meeting',
      tasks: { takusTasks: [], meTasks: [] },
    }));
    const html = wellbeingCard(recentMeetings);
    expect(html).toContain('Meeting fatigue');
  });

  it('shows positive message when no suggestions', () => {
    const recordings = [{
      id: 'r1', title: 'Quick Screen', date: Date.now() - 86400000,
      duration: 10000, size: 256, type: 'screen',
      tasks: { takusTasks: [], meTasks: [] },
    }];
    const html = wellbeingCard(recordings);
    expect(html).toContain('good shape');
  });

  it('handles recordings without tasks gracefully', () => {
    const recordings = [{
      id: 'r1', title: 'No Tasks', date: Date.now(), duration: 60000,
      size: 1024, type: 'screen',
    }];
    const html = wellbeingCard(recordings);
    expect(html).toContain('Wellbeing');
    expect(html).toContain('0'); // 0 pending tasks
  });
});
