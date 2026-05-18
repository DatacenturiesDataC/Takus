// Tests for drag-drop-handler.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../lib/icons.js', () => ({
  icons: new Proxy({}, { get: () => (size) => `<svg size="${size}"/>` }),
}));

vi.mock('../../lib/recorder.js', () => ({
  formatSize: (bytes) => `${Math.round(bytes / 1024)} KB`,
}));

vi.mock('../../lib/notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

import { initDragDrop } from '../../lib/drag-drop-handler.js';
import { notifyEphemeral } from '../../lib/notification-manager.js';

describe('drag-drop-handler', () => {
  let onFileDrop;
  let sm;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    onFileDrop = vi.fn();
    sm = { is: (...states) => states.includes('IDLE') };
    initDragDrop({
      sm,
      States: { IDLE: 'IDLE', RECORDING: 'RECORDING' },
      onFileDrop,
    });
  });

  it('rejects files over 2 GB', () => {
    const file = new File([''], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 3 * 1024 * 1024 * 1024 });
    Object.defineProperty(file, 'name', { value: 'huge.mp4' });

    const dropEvent = new Event('drop', { bubbles: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file] },
    });
    dropEvent.preventDefault = vi.fn();
    document.dispatchEvent(dropEvent);

    expect(notifyEphemeral).toHaveBeenCalledWith('File too large', 'Maximum upload size is 2 GB.', 'error');
    expect(onFileDrop).not.toHaveBeenCalled();
  });

  it('rejects unsupported file types', () => {
    const file = new File([''], 'image.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 1024 });

    const dropEvent = new Event('drop', { bubbles: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file] },
    });
    dropEvent.preventDefault = vi.fn();
    document.dispatchEvent(dropEvent);

    expect(notifyEphemeral).toHaveBeenCalledWith('Unsupported format', expect.stringContaining('webm'), 'error');
    expect(onFileDrop).not.toHaveBeenCalled();
  });

  it('accepts valid video files', () => {
    const file = new File(['video'], 'entry.webm', { type: 'video/webm' });
    Object.defineProperty(file, 'size', { value: 5000 });

    const dropEvent = new Event('drop', { bubbles: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file] },
    });
    dropEvent.preventDefault = vi.fn();
    document.dispatchEvent(dropEvent);

    expect(notifyEphemeral).toHaveBeenCalled();
    expect(onFileDrop).toHaveBeenCalledWith(file);
  });

  it('does not process drops when not in IDLE state', () => {
    sm.is = () => false; // Not IDLE

    const file = new File(['video'], 'rec.webm', { type: 'video/webm' });
    Object.defineProperty(file, 'size', { value: 5000 });

    const dropEvent = new Event('drop', { bubbles: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file] },
    });
    dropEvent.preventDefault = vi.fn();
    document.dispatchEvent(dropEvent);

    expect(onFileDrop).not.toHaveBeenCalled();
  });
});
