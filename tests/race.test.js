import { describe, expect, it } from 'vitest';
import { dailyReplayMatchesSession } from '../src/race.js';

describe('Daily ghost validation', () => {
  const session = {
    mode: 'daily', day: '2026-07-17', seed: 42, rules: 4,
  };

  it('only races replays from the issued Daily board', () => {
    expect(dailyReplayMatchesSession({
      mode: 'daily', day: '2026-07-17', seed: 42, rules: 4,
    }, session)).toBe(true);
    expect(dailyReplayMatchesSession({
      mode: 'daily', day: '2026-07-16', seed: 42, rules: 4,
    }, session)).toBe(false);
    expect(dailyReplayMatchesSession({
      mode: 'daily', day: '2026-07-17', seed: 99, rules: 4,
    }, session)).toBe(false);
    expect(dailyReplayMatchesSession({
      mode: 'classic', day: '2026-07-17', seed: 42, rules: 4,
    }, session)).toBe(false);
    expect(dailyReplayMatchesSession({
      mode: 'daily', day: '2026-07-17', seed: 42, rules: 3,
    }, session)).toBe(false);
  });
});
