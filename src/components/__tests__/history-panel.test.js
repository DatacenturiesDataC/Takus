// Takus — History Panel Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set up mocks
vi.mock('../../lib/icons.js', () => ({
  icons: new Proxy({}, {
    get: () => () => '<svg></svg>',
  }),
}));

vi.mock('../../lib/storage.js', () => ({
  getEntries: vi.fn().mockResolvedValue([]),
  getAllEmbeddings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../apps/passport/index.js', () => ({
  getDisplayName: vi.fn().mockReturnValue('Test User'),
}));

vi.mock('../../lib/graph/task-store.js', () => ({
  getAllTasks: vi.fn().mockResolvedValue([]),
  getTaskCounts: vi.fn().mockResolvedValue({ pending: 0, done: 0, total: 0 }),
}));

vi.mock('../../lib/wellbeing.js', () => ({
  getTaskLoadHealth: vi.fn().mockReturnValue({ overloaded: false, pendingCount: 0, suggestion: null }),
}));

vi.mock('../tasks-panel.js', () => ({
  renderTasksPanel: vi.fn(),
  tasksBadge: vi.fn(),
}));

vi.mock('../../lib/content-types.js', () => ({
  typeLabel: vi.fn((t) => t),
  typeAccent: vi.fn(() => '#6366f1'),
  getCategory: vi.fn((t) => t),
}));

import { renderHistoryPanel, VirtualList } from '../history-panel.js';
import { getDisplayName } from '../../apps/passport/index.js';
import { getTaskCounts, getAllTasks } from '../../lib/graph/task-store.js';
import { getTaskLoadHealth } from '../../lib/wellbeing.js';
import { getEntries } from '../../lib/storage.js';

describe('HistoryPanel - Initial Greeting & Dashboard Personalization', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    vi.clearAllMocks();
  });

  it('renders welcome banner with ownerName and default task text when entries are empty', async () => {
    vi.mocked(getEntries).mockResolvedValue([]);
    vi.mocked(getDisplayName).mockReturnValue('Khalid');
    vi.mocked(getTaskCounts).mockResolvedValue({ pending: 2, done: 1, total: 3 });

    await renderHistoryPanel(container);

    const banner = container.querySelector('#history-welcome-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('Khalid');
    expect(banner.textContent).toContain('You have 2 pending tasks');
  });

  it('renders time-of-day appropriate greeting', async () => {
    vi.mocked(getEntries).mockResolvedValue([]);
    vi.mocked(getDisplayName).mockReturnValue('Alice');

    // Morning (9 AM)
    vi.useFakeTimers({ now: new Date(2026, 4, 20, 9, 0, 0) });
    await renderHistoryPanel(container);
    let banner = container.querySelector('#history-welcome-banner');
    expect(banner.textContent).toContain('Good morning, Alice!');

    // Afternoon (2 PM)
    vi.setSystemTime(new Date(2026, 4, 20, 14, 0, 0));
    await renderHistoryPanel(container);
    banner = container.querySelector('#history-welcome-banner');
    expect(banner.textContent).toContain('Good afternoon, Alice!');

    // Evening (8 PM)
    vi.setSystemTime(new Date(2026, 4, 20, 20, 0, 0));
    await renderHistoryPanel(container);
    banner = container.querySelector('#history-welcome-banner');
    expect(banner.textContent).toContain('Good evening, Alice!');

    vi.useRealTimers();
  });

  it('renders wellbeing suggestion when overloaded with tasks', async () => {
    vi.mocked(getEntries).mockResolvedValue([]);
    vi.mocked(getDisplayName).mockReturnValue('Bob');
    vi.mocked(getTaskLoadHealth).mockReturnValue({
      overloaded: true,
      pendingCount: 18,
      suggestion: 'Consider triaging — what can you delegate, defer, or drop?',
    });

    await renderHistoryPanel(container);

    const banner = container.querySelector('#history-welcome-banner');
    expect(banner.textContent).toContain('You have 18 pending tasks. Consider triaging');
  });

  it('hides welcome banner when search query is entered', async () => {
    vi.useFakeTimers();
    // Render with some entries so search input exists
    vi.mocked(getEntries).mockResolvedValue([
      { id: '1', title: 'Entry 1', type: 'screen', date: Date.now() },
      { id: '2', title: 'Entry 2', type: 'screen', date: Date.now() },
      { id: '3', title: 'Entry 3', type: 'screen', date: Date.now() },
      { id: '4', title: 'Entry 4', type: 'screen', date: Date.now() },
      { id: '5', title: 'Entry 5', type: 'screen', date: Date.now() },
    ]);

    await renderHistoryPanel(container);

    const banner = container.querySelector('#history-welcome-banner');
    expect(banner).not.toBeNull();
    expect(banner.style.display).not.toBe('none');

    // Trigger search
    const searchInput = container.querySelector('#history-search');
    expect(searchInput).not.toBeNull();
    searchInput.value = 'Entry';
    searchInput.dispatchEvent(new Event('input'));

    // Advance timers
    vi.advanceTimersByTime(250);

    expect(banner.style.display).toBe('none');
    vi.useRealTimers();
  });

  it('hides welcome banner when a filter is clicked', async () => {
    vi.mocked(getEntries).mockResolvedValue([
      { id: '1', title: 'Entry 1', type: 'screen', date: Date.now() },
      { id: '2', title: 'Entry 2', type: 'document', date: Date.now() },
    ]);

    await renderHistoryPanel(container);

    const banner = container.querySelector('#history-welcome-banner');
    expect(banner).not.toBeNull();
    expect(banner.style.display).not.toBe('none');

    // Click on a type filter chip
    const typeChip = container.querySelector('.type-chip[data-type="screen"]');
    expect(typeChip).not.toBeNull();
    typeChip.click();

    expect(banner.style.display).toBe('none');
  });
});

describe('VirtualList', () => {
  let listEl;
  let options;

  beforeEach(() => {
    listEl = document.createElement('div');
    listEl.style.height = '200px';
    options = {
      items: [
        { id: '1', title: 'Item 1' },
        { id: '2', title: 'Item 2' },
        { id: '3', title: 'Item 3' },
        { id: '4', title: 'Item 4' },
        { id: '5', title: 'Item 5' },
      ],
      buildHTML: (item) => `<div class="history-item" data-id="${item.id}">${item.title}</div>`,
      bindHandlers: vi.fn(),
      restoreExpandedState: vi.fn(),
      defaultHeight: 50,
      buffer: 1,
    };
  });

  it('renders visible items plus buffer, hiding off-screen items', () => {
    const list = new VirtualList(listEl, options);
    list.scrollTop = 0;
    list.render();

    const rendered = listEl.querySelectorAll('.history-item');
    expect(rendered.length).toBe(5);
    expect(rendered[0].textContent).toBe('Item 1');
    expect(options.bindHandlers).toHaveBeenCalledTimes(5);
  });

  it('correctly updates items list', () => {
    const list = new VirtualList(listEl, options);
    list.render();

    list.updateItems([
      { id: '6', title: 'Item 6' },
      { id: '7', title: 'Item 7' },
    ]);

    const rendered = listEl.querySelectorAll('.history-item');
    expect(rendered.length).toBe(2);
    expect(rendered[0].textContent).toBe('Item 6');
  });

  it('removes scroll event listener on destroy', () => {
    const removeSpy = vi.spyOn(listEl, 'removeEventListener');
    const list = new VirtualList(listEl, options);
    list.destroy();
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
