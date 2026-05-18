// Takus — History Item Template Unit Tests
import { describe, it, expect } from 'vitest';
import { renderHistoryItem, buildHistoryItems } from '../../components/history-cards/item-template.js';

const mockRec = (overrides = {}) => ({
  id: 'entry_test_1',
  title: 'Test Recording',
  date: Date.now(),
  duration: 60000,
  size: 1024,
  type: 'screen',
  state: 'ready',
  ...overrides,
});

describe('renderHistoryItem', () => {
  it('renders a history item with data attributes', () => {
    const html = renderHistoryItem(mockRec(), '', false, new Set(), '');
    expect(html).toContain('data-id="entry_test_1"');
    expect(html).toContain('history-item');
    expect(html).toContain('Test Recording');
  });

  it('shows inbox badge for raw state', () => {
    const html = renderHistoryItem(mockRec({ state: 'raw' }), '', false, new Set(), '');
    expect(html).toContain('Inbox');
    expect(html).toContain('history-process-raw');
    expect(html).toContain('opacity:0.55');
  });

  it('shows processing indicator for processing state', () => {
    const html = renderHistoryItem(mockRec({ state: 'processing' }), '', false, new Set(), '');
    expect(html).toContain('Processing');
    expect(html).toContain('opacity:0.7');
  });

  it('shows checkboxes when selectMode is true', () => {
    const html = renderHistoryItem(mockRec(), '', true, new Set(), '');
    expect(html).toContain('display:block');
  });

  it('hides checkboxes when selectMode is false', () => {
    const html = renderHistoryItem(mockRec(), '', false, new Set(), '');
    expect(html).toContain('display:none');
  });

  it('marks checkbox as checked when ID is in selectedIds', () => {
    const html = renderHistoryItem(mockRec(), '', true, new Set(['entry_test_1']), '');
    expect(html).toContain('checked');
  });

  it('renders AI summary toggle when aiSummary exists', () => {
    const html = renderHistoryItem(mockRec({ aiSummary: '# Summary\nHello' }), '', false, new Set(), '');
    expect(html).toContain('history-summary-toggle');
    expect(html).toContain('ai-summary-box');
  });

  it('does not render AI summary toggle without aiSummary', () => {
    const html = renderHistoryItem(mockRec(), '', false, new Set(), '');
    expect(html).not.toContain('history-summary-toggle');
  });

  it('renders pin button with pinned class when pinned', () => {
    const html = renderHistoryItem(mockRec({ pinned: true }), '', false, new Set(), '');
    expect(html).toContain('history-pin pinned');
    expect(html).toContain('Unpin entry');
  });

  it('renders tags when present', () => {
    const html = renderHistoryItem(mockRec({ tags: ['sprint', 'review'] }), '', false, new Set(), '');
    expect(html).toContain('history-tag-chip');
    expect(html).toContain('sprint');
    expect(html).toContain('review');
  });

  it('highlights active tag filter', () => {
    const html = renderHistoryItem(mockRec({ tags: ['sprint'] }), '', false, new Set(), 'sprint');
    expect(html).toContain('history-tag-chip active');
  });

  it('renders note preview when notes exist', () => {
    const html = renderHistoryItem(mockRec({ notes: 'My notes here' }), '', false, new Set(), '');
    expect(html).toContain('history-note-preview');
  });

  it('renders drive link when present', () => {
    const html = renderHistoryItem(mockRec({ driveLink: 'https://drive.google.com/file/123' }), '', false, new Set(), '');
    expect(html).toContain('history-copy-link');
    expect(html).toContain('Open in cloud');
  });

  it('does not render drive link for invalid URLs', () => {
    const html = renderHistoryItem(mockRec({ driveLink: 'javascript:alert(1)' }), '', false, new Set(), '');
    expect(html).not.toContain('history-copy-link');
  });
});

describe('buildHistoryItems', () => {
  it('returns no-match message for empty list', () => {
    const html = buildHistoryItems([], '', false, new Set(), '');
    expect(html).toContain('No entries match');
  });

  it('renders all items in a list', () => {
    const list = [
      mockRec({ id: 'r1', title: 'First' }),
      mockRec({ id: 'r2', title: 'Second' }),
    ];
    const html = buildHistoryItems(list, '', false, new Set(), '');
    expect(html).toContain('data-id="r1"');
    expect(html).toContain('data-id="r2"');
    expect(html).toContain('First');
    expect(html).toContain('Second');
  });
});
