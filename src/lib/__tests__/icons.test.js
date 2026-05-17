// Takus — Icons Unit Tests
import { describe, it, expect } from 'vitest';
import { icons } from '../icons.js';

describe('icons', () => {
  const iconNames = Object.keys(icons);

  it('exports at least 30 icon functions', () => {
    expect(iconNames.length).toBeGreaterThanOrEqual(30);
  });

  it('every icon is a function', () => {
    for (const name of iconNames) {
      expect(typeof icons[name]).toBe('function');
    }
  });

  it('returns valid SVG strings', () => {
    for (const name of iconNames) {
      const svg = icons[name](16);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    }
  });

  it('respects size parameter', () => {
    const svg24 = icons.video(24);
    const svg16 = icons.video(16);
    expect(svg24).toContain('width="24"');
    expect(svg24).toContain('height="24"');
    expect(svg16).toContain('width="16"');
    expect(svg16).toContain('height="16"');
  });

  it('uses default size of 24 when no argument', () => {
    const svg = icons.video();
    expect(svg).toContain('width="24"');
    expect(svg).toContain('height="24"');
  });

  it('includes stroke attributes for accessibility', () => {
    const svg = icons.check(14);
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke-linecap="round"');
  });

  it('each icon has unique path data', () => {
    const paths = new Set();
    for (const name of iconNames) {
      const svg = icons[name](16);
      // Extract the inner content (between <svg> and </svg>)
      const inner = svg.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '');
      paths.add(inner);
    }
    // All icons should produce unique SVG content
    expect(paths.size).toBe(iconNames.length);
  });
});
