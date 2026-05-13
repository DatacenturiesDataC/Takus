// Takus — Archive Engine Tests
// Tests eligibility checks, content classification, and key frame timestamp generation.
import { describe, it, expect } from 'vitest';
import { checkEligibility, classifyContent, ContentClass, ArchiveStatus } from '../archive-engine.js';

describe('checkEligibility', () => {
  const NOW = Date.now();
  const daysAgo = (n) => NOW - n * 24 * 60 * 60 * 1000;

  it('eligible: old recording, cloud-synced, not pinned', () => {
    const rec = { id: 'r1', date: daysAgo(45) };
    const vs = { drivePackageUploaded: true, archiveStatus: 'active' };
    const result = checkEligibility(rec, vs);
    expect(result.eligible).toBe(true);
  });

  it('ineligible: already archived', () => {
    const rec = { id: 'r1', date: daysAgo(45) };
    const vs = { drivePackageUploaded: true, archiveStatus: ArchiveStatus.ARCHIVED };
    expect(checkEligibility(rec, vs).eligible).toBe(false);
    expect(checkEligibility(rec, vs).reason).toContain('Already archived');
  });

  it('ineligible: archive pending', () => {
    const rec = { id: 'r1', date: daysAgo(45) };
    const vs = { drivePackageUploaded: true, archiveStatus: ArchiveStatus.PENDING };
    expect(checkEligibility(rec, vs).eligible).toBe(false);
    expect(checkEligibility(rec, vs).reason).toContain('pending');
  });

  it('ineligible: cold storage', () => {
    const rec = { id: 'r1', date: daysAgo(200) };
    const vs = { drivePackageUploaded: true, archiveStatus: ArchiveStatus.COLD };
    expect(checkEligibility(rec, vs).eligible).toBe(false);
  });

  it('ineligible: pinned recording', () => {
    const rec = { id: 'r1', date: daysAgo(45), pinned: true };
    const vs = { drivePackageUploaded: true };
    expect(checkEligibility(rec, vs).eligible).toBe(false);
    expect(checkEligibility(rec, vs).reason).toContain('pinned');
  });

  it('ineligible: pinned via vault sync', () => {
    const rec = { id: 'r1', date: daysAgo(45) };
    const vs = { drivePackageUploaded: true, pinned: true };
    expect(checkEligibility(rec, vs).eligible).toBe(false);
  });

  it('ineligible: legal hold', () => {
    const rec = { id: 'r1', date: daysAgo(45), legalHold: true };
    const vs = { drivePackageUploaded: true };
    expect(checkEligibility(rec, vs).eligible).toBe(false);
    expect(checkEligibility(rec, vs).reason).toContain('legal hold');
  });

  it('ineligible: too recent (under 30 days)', () => {
    const rec = { id: 'r1', date: daysAgo(15) };
    const vs = { drivePackageUploaded: true };
    expect(checkEligibility(rec, vs).eligible).toBe(false);
    expect(checkEligibility(rec, vs).reason).toContain('15 days old');
  });

  it('ineligible: not synced to cloud', () => {
    const rec = { id: 'r1', date: daysAgo(45) };
    const vs = { drivePackageUploaded: false };
    expect(checkEligibility(rec, vs).eligible).toBe(false);
    expect(checkEligibility(rec, vs).reason).toContain('not yet synced');
  });

  it('ineligible: no vault sync at all', () => {
    const rec = { id: 'r1', date: daysAgo(45) };
    expect(checkEligibility(rec, null).eligible).toBe(false);
  });

  it('respects custom archiveAfterDays', () => {
    const rec = { id: 'r1', date: daysAgo(10) };
    const vs = { drivePackageUploaded: true };
    // Default 30 days — not eligible at 10 days
    expect(checkEligibility(rec, vs).eligible).toBe(false);
    // Custom 7 days — eligible at 10 days
    expect(checkEligibility(rec, vs, 7).eligible).toBe(true);
  });
});

describe('classifyContent', () => {
  it('meeting → transcript-centric', () => {
    expect(classifyContent({ type: 'meeting' })).toBe(ContentClass.TRANSCRIPT);
  });

  it('update → transcript-centric', () => {
    expect(classifyContent({ type: 'update' })).toBe(ContentClass.TRANSCRIPT);
  });

  it('presentation → slide-screen-share', () => {
    expect(classifyContent({ type: 'presentation' })).toBe(ContentClass.SLIDE);
  });

  it('long screen → slide-screen-share', () => {
    expect(classifyContent({ type: 'screen', duration: 1200 })).toBe(ContentClass.SLIDE);
  });

  it('short screen → dynamic-visual', () => {
    expect(classifyContent({ type: 'screen', duration: 120 })).toBe(ContentClass.DYNAMIC);
  });

  it('screen with no duration → dynamic-visual', () => {
    expect(classifyContent({ type: 'screen' })).toBe(ContentClass.DYNAMIC);
  });

  it('unknown type → slide-screen-share (default)', () => {
    expect(classifyContent({ type: 'unknown' })).toBe(ContentClass.SLIDE);
  });

  it('no type → dynamic-visual (defaults to screen)', () => {
    expect(classifyContent({})).toBe(ContentClass.DYNAMIC);
  });
});
