import { describe, it, expect } from 'vitest';
import { toGrid, isValidUsername } from '../server/github.js';

function makeDays(startISO, count, levelFn) {
  const start = new Date(startISO + 'T00:00:00Z');
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), level: levelFn(i) };
  });
}

describe('toGrid', () => {
  it('produces a 52x7 grid with Monday-first rows', () => {
    // 2025-07-07 is a Monday.
    const days = makeDays('2025-07-07', 364, (i) => i % 5);
    const { grid, months } = toGrid(days);
    expect(grid).toHaveLength(52);
    expect(grid.every((col) => col.length === 7)).toBe(true);
    // First day (a Monday, level 0) lands at column 0 row 0; next day row 1.
    expect(grid[0][1]).toBe(1);
    expect(grid[0][6]).toBe(1); // day 6 → 6 % 5 = 1
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('Jul');
  });

  it('aligns a mid-week start to its Monday column', () => {
    // 2025-07-09 is a Wednesday; its cell belongs in column 0, row 2.
    const days = makeDays('2025-07-09', 7, () => 4);
    const { grid } = toGrid(days);
    expect(grid[0][2]).toBe(4);
    expect(grid[0][0]).toBe(0); // that Monday is empty — no data for it
    expect(grid[1][0]).toBe(4); // the following Monday starts column 1
  });
});

describe('isValidUsername', () => {
  it('accepts real GitHub username shapes', () => {
    expect(isValidUsername('ashleymcnamara')).toBe(true);
    expect(isValidUsername('a-b-c')).toBe(true);
    expect(isValidUsername('x')).toBe(true);
  });

  it('rejects invalid shapes', () => {
    expect(isValidUsername('')).toBe(false);
    expect(isValidUsername('-leading')).toBe(false);
    expect(isValidUsername('double--dash')).toBe(false);
    expect(isValidUsername('way'.repeat(20))).toBe(false);
    expect(isValidUsername('bad/path')).toBe(false);
  });
});
