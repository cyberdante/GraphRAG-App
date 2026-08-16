import { describe, expect, it } from 'vitest';
import { AA_NORMAL, auditContrast, contrastRatio, luminance, parseColor, readableOn } from './contrast';

describe('parseColor', () => {
  it('reads six-digit hex', () => {
    expect(parseColor('#1976d2')).toEqual({ r: 0x19, g: 0x76, b: 0xd2 });
  });

  it('expands three-digit hex', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('reads rgb() and rgba() notation', () => {
    expect(parseColor('rgb(20, 30, 40)')).toEqual({ r: 20, g: 30, b: 40 });
    expect(parseColor('rgba(20, 30, 40, 0.5)')).toEqual({ r: 20, g: 30, b: 40 });
  });

  it('rejects something it cannot read rather than guessing', () => {
    expect(() => parseColor('cornflowerblue')).toThrow(/cannot parse/i);
  });
});

describe('luminance', () => {
  it('anchors at the extremes', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('contrastRatio', () => {
  it('gives 21 for black on white, the maximum', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('gives 1 for a colour on itself', () => {
    expect(contrastRatio('#1976d2', '#1976d2')).toBeCloseTo(1, 5);
  });

  it('is symmetric — order of arguments does not matter', () => {
    expect(contrastRatio('#1976d2', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#1976d2'),
      5,
    );
  });
});

describe('readableOn', () => {
  it('picks white on a dark brand colour', () => {
    expect(readableOn('#1a1a2e')).toBe('#FFFFFF');
  });

  it('picks dark on a pale brand colour', () => {
    // The case that motivates all of this: a tenant supplies pale yellow, and
    // assuming white text would leave their product unreadable.
    const pale = '#F7E967';
    expect(readableOn(pale)).toBe('#111111');
    expect(contrastRatio(readableOn(pale), pale)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('always returns the higher-contrast of the two candidates', () => {
    for (const color of ['#1976d2', '#B45309', '#4C1D95', '#F7E967', '#FFFFFF', '#000000']) {
      const chosen = readableOn(color);
      const other = chosen === '#FFFFFF' ? '#111111' : '#FFFFFF';
      expect(contrastRatio(chosen, color)).toBeGreaterThanOrEqual(contrastRatio(other, color));
    }
  });
});

describe('auditContrast', () => {
  it('returns nothing when every pairing passes', () => {
    expect(
      auditContrast([{ label: 'body', foreground: '#111111', background: '#ffffff' }]),
    ).toEqual([]);
  });

  it('reports the pairings that fail, with their ratios', () => {
    const issues = auditContrast([
      { label: 'ok', foreground: '#000000', background: '#ffffff' },
      { label: 'too low', foreground: '#cccccc', background: '#ffffff' },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.label).toBe('too low');
    expect(issues[0]?.ratio).toBeLessThan(AA_NORMAL);
  });

  it('honours a relaxed requirement for large text', () => {
    const pair = { label: 'heading', foreground: '#767676', background: '#ffffff' };
    expect(auditContrast([{ ...pair, required: 3 }])).toEqual([]);
    expect(auditContrast([{ ...pair, required: 7 }])).toHaveLength(1);
  });
});
