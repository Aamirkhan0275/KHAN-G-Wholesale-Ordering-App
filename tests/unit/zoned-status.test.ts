import { describe, expect, it } from 'vitest';
import { isoWeekKey, weekStartLocalDate, zonedParts, localDateString } from '../../shared/zoned';
import { canTransition, lineStatusFor, STATUS_TRANSITIONS, ORDER_STATUSES } from '../../shared/status';

describe('timezone helpers', () => {
  it('zonedParts converts to Asia/Karachi (UTC+5)', () => {
    const z = zonedParts(new Date('2026-11-15T20:30:00Z'), 'Asia/Karachi'); // Mon 01:30 PKT
    expect(z).toMatchObject({ year: 2026, month: 11, day: 16, hour: 1, minute: 30, weekday: 1 });
  });
  it('ISO week keys incl. year boundaries', () => {
    expect(isoWeekKey(2026, 11, 13)).toBe('2026-W46');
    expect(isoWeekKey(2026, 1, 1)).toBe('2026-W01');
    expect(isoWeekKey(2027, 1, 1)).toBe('2026-W53');
    expect(isoWeekKey(2024, 12, 30)).toBe('2025-W01');
  });
  it('week starts on Monday in local time', () => {
    expect(weekStartLocalDate(new Date('2026-11-13T10:00:00Z'), 'Asia/Karachi')).toBe('2026-11-09');
    expect(weekStartLocalDate(new Date('2026-11-15T20:30:00Z'), 'Asia/Karachi')).toBe('2026-11-16'); // already Monday in PKT
    expect(localDateString(new Date('2026-11-15T20:30:00Z'), 'Asia/Karachi')).toBe('2026-11-16');
  });
});

describe('order status model', () => {
  it('final states have no transitions', () => {
    expect(STATUS_TRANSITIONS.delivered).toEqual([]);
    expect(STATUS_TRANSITIONS.cancelled).toEqual([]);
  });
  it('every transition target is a known status', () => {
    for (const s of ORDER_STATUSES) for (const t of STATUS_TRANSITIONS[s]) expect(ORDER_STATUSES).toContain(t);
  });
  it('allows the normal path and blocks going backwards', () => {
    expect(canTransition('submitted', 'checking')).toBe(true);
    expect(canTransition('checking', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'ready')).toBe(true);
    expect(canTransition('ready', 'delivered')).toBe(true);
    expect(canTransition('delivered', 'checking')).toBe(false);
    expect(canTransition('confirmed', 'submitted')).toBe(false);
    expect(canTransition('cancelled', 'confirmed')).toBe(false);
  });
  it('line status from requested vs approved', () => {
    expect(lineStatusFor(5, 5)).toBe('available');
    expect(lineStatusFor(5, 3)).toBe('partial');
    expect(lineStatusFor(5, 0)).toBe('unavailable');
  });
});
