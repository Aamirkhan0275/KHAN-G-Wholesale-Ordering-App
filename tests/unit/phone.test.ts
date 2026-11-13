import { describe, expect, it } from 'vitest';
import { normalizePhone, formatPhone } from '../../shared/phone';

describe('normalizePhone', () => {
  it.each([
    ['03001234567', '+923001234567'],
    ['0300-1234567', '+923001234567'],
    ['0300 123 4567', '+923001234567'],
    ['+92 300 1234567', '+923001234567'],
    ['923001234567', '+923001234567'],
    ['00923001234567', '+923001234567'],
    ['3001234567', '+923001234567'],
    ['۰۳۰۰۱۲۳۴۵۶۷', '+923001234567'], // Urdu digits
    ['+44 7700 900123', '+447700900123'],
  ])('accepts %s', (input, expected) => {
    expect(normalizePhone(input)).toEqual({ ok: true, e164: expected });
  });

  it.each([
    ['', 'empty'], ['   ', 'empty'], [null, 'empty'],
    ['0300123456', 'invalid'],      // too short
    ['030012345678', 'invalid'],    // too long
    ['0423456789', 'invalid'],      // landline, not mobile
    ['+92 42 1234567', 'invalid'],
    ['abc', 'invalid'], ['0300-12345a7', 'invalid'], ['++923001234567', 'invalid'],
    ['12345678', 'invalid'],        // no country code and not PK
  ])('rejects %s', (input, error) => {
    expect(normalizePhone(input as any)).toEqual({ ok: false, error });
  });

  it('formats PK numbers for display', () => {
    expect(formatPhone('+923001234567')).toBe('0300 1234567');
    expect(formatPhone('+447700900123')).toBe('+447700900123');
  });
});
