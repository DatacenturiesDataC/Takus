// Tests for qr-code.js — QR SVG generation
import { describe, it, expect } from 'vitest';
import { generateQRSvg } from '../qr-code.js';

describe('generateQRSvg', () => {
  it('returns valid SVG markup', () => {
    const svg = generateQRSvg('https://takus.app');
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('</svg>');
  });

  it('respects custom size', () => {
    const svg = generateQRSvg('test', { size: 300 });
    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="300"');
    expect(svg).toContain('viewBox="0 0 300 300"');
  });

  it('uses custom foreground color', () => {
    const svg = generateQRSvg('test', { fg: '#ff0000' });
    expect(svg).toContain('fill="#ff0000"');
  });

  it('uses custom background color', () => {
    const svg = generateQRSvg('test', { bg: '#000000' });
    expect(svg).toContain('fill="#000000"');
  });

  it('defaults to 200px size', () => {
    const svg = generateQRSvg('hello');
    expect(svg).toContain('width="200"');
  });

  it('contains rect elements for QR modules', () => {
    const svg = generateQRSvg('hello world');
    // QR codes always have finder patterns → must have multiple rects
    const rectCount = (svg.match(/<rect /g) || []).length;
    expect(rectCount).toBeGreaterThan(10);
  });

  it('generates different patterns for different data', () => {
    const svg1 = generateQRSvg('data-1');
    const svg2 = generateQRSvg('data-2');
    // Different data should produce different rect patterns
    expect(svg1).not.toBe(svg2);
  });

  it('handles longer URLs', () => {
    const url = 'https://example.com/very/long/path/with/many/segments?key=value&another=param';
    const svg = generateQRSvg(url);
    expect(svg).toContain('<svg');
    const rectCount = (svg.match(/<rect /g) || []).length;
    expect(rectCount).toBeGreaterThan(50); // Longer data → more modules
  });

  it('throws for data exceeding max capacity', () => {
    const tooLong = 'x'.repeat(300); // > 271 byte max
    expect(() => generateQRSvg(tooLong)).toThrow(/too long/i);
  });

  it('produces consistent output for same input', () => {
    const svg1 = generateQRSvg('deterministic');
    const svg2 = generateQRSvg('deterministic');
    expect(svg1).toBe(svg2);
  });
});
