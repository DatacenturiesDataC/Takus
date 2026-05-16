// Takus — Upload Tracker Tests (Phase 57)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  trackUpload, updateUploadProgress, completeUpload, failUpload,
  retryUpload, markConverting, getActiveUploads, getAllUploads,
  clearCompleted, getUploadStats, onUploadChange,
} from '../upload-tracker.js';

describe('Upload Tracker', () => {
  beforeEach(() => {
    clearCompleted();
  });

  describe('trackUpload', () => {
    it('creates a queued entry', () => {
      const entry = trackUpload('rec_1', 'test.webm', 1024);
      expect(entry.id).toBe('rec_1');
      expect(entry.status).toBe('queued');
      expect(entry.progress).toBe(0);
      expect(entry.size).toBe(1024);
    });
  });

  describe('updateUploadProgress', () => {
    it('updates progress and sets status to uploading', () => {
      trackUpload('rec_2', 'test.webm');
      updateUploadProgress('rec_2', 50);
      const uploads = getAllUploads();
      const entry = uploads.find(u => u.id === 'rec_2');
      expect(entry.status).toBe('uploading');
      expect(entry.progress).toBe(50);
    });

    it('clamps progress to 0-100', () => {
      trackUpload('rec_clamp', 'test.webm');
      updateUploadProgress('rec_clamp', 150);
      const entry = getAllUploads().find(u => u.id === 'rec_clamp');
      expect(entry.progress).toBe(100);
    });
  });

  describe('completeUpload', () => {
    it('marks upload as done with link', () => {
      trackUpload('rec_3', 'test.webm');
      completeUpload('rec_3', 'https://drive.google.com/xxx');
      const entry = getAllUploads().find(u => u.id === 'rec_3');
      expect(entry.status).toBe('done');
      expect(entry.progress).toBe(100);
      expect(entry.link).toBe('https://drive.google.com/xxx');
      expect(entry.completedAt).toBeTruthy();
    });
  });

  describe('failUpload', () => {
    it('marks upload as error', () => {
      trackUpload('rec_4', 'test.webm');
      failUpload('rec_4', 'Network timeout');
      const entry = getAllUploads().find(u => u.id === 'rec_4');
      expect(entry.status).toBe('error');
      expect(entry.error).toBe('Network timeout');
    });
  });

  describe('retryUpload', () => {
    it('resets progress and records attempt', () => {
      trackUpload('rec_5', 'test.webm');
      failUpload('rec_5', 'timeout');
      retryUpload('rec_5', 2);
      const entry = getAllUploads().find(u => u.id === 'rec_5');
      expect(entry.status).toBe('uploading');
      expect(entry.attempt).toBe(2);
      expect(entry.progress).toBe(0);
      expect(entry.error).toBeNull();
    });
  });

  describe('markConverting', () => {
    it('sets status to converting', () => {
      trackUpload('rec_6', 'test.webm');
      markConverting('rec_6', 'mp4');
      const entry = getAllUploads().find(u => u.id === 'rec_6');
      expect(entry.status).toBe('converting');
    });
  });

  describe('getActiveUploads', () => {
    it('returns only active uploads', () => {
      trackUpload('active_1', 'a.webm');
      trackUpload('active_2', 'b.webm');
      completeUpload('active_2');
      const active = getActiveUploads();
      expect(active.some(u => u.id === 'active_1')).toBe(true);
      expect(active.some(u => u.id === 'active_2')).toBe(false);
    });
  });

  describe('getUploadStats', () => {
    it('returns aggregate stats', () => {
      trackUpload('stat_1', 'a.webm', 500);
      trackUpload('stat_2', 'b.webm', 1000);
      completeUpload('stat_2');
      const stats = getUploadStats();
      expect(stats.active).toBeGreaterThanOrEqual(1);
      expect(stats.completed).toBeGreaterThanOrEqual(1);
      expect(stats.totalBytes).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('onUploadChange', () => {
    it('notifies listeners on state change', () => {
      const listener = vi.fn();
      const unsub = onUploadChange(listener);
      trackUpload('notify_1', 'test.webm');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: 'notify_1', status: 'queued' }));
      updateUploadProgress('notify_1', 50);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: 'notify_1', status: 'uploading', progress: 50 }));
      unsub();
    });

    it('unsubscribes correctly', () => {
      const listener = vi.fn();
      const unsub = onUploadChange(listener);
      unsub();
      trackUpload('notify_2', 'test.webm');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('clearCompleted', () => {
    it('removes done and error entries', () => {
      trackUpload('clear_1', 'a.webm');
      trackUpload('clear_2', 'b.webm');
      completeUpload('clear_1');
      failUpload('clear_2', 'err');
      clearCompleted();
      const uploads = getAllUploads();
      expect(uploads.find(u => u.id === 'clear_1')).toBeUndefined();
      expect(uploads.find(u => u.id === 'clear_2')).toBeUndefined();
    });
  });
});
