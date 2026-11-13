/**
 * Mobile number normalization. Numbers are stored in E.164 form (+923001234567).
 * Pakistani formats are accepted without a country code; other countries must
 * be entered with a leading + and country code.
 */
export type PhoneResult = { ok: true; e164: string } | { ok: false; error: 'empty' | 'invalid' };

export function normalizePhone(input: string | null | undefined, defaultCountry: 'PK' = 'PK'): PhoneResult {
  if (input == null) return { ok: false, error: 'empty' };
  // Allow Urdu/Arabic-Indic digits as well as ASCII digits.
  const ascii = String(input)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
  if (!ascii) return { ok: false, error: 'empty' };
  if (/[^0-9+\-\s().]/.test(ascii)) return { ok: false, error: 'invalid' };
  const hasPlus = ascii.startsWith('+');
  if (ascii.indexOf('+', 1) !== -1) return { ok: false, error: 'invalid' };
  let digits = ascii.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (!hasPlus && defaultCountry === 'PK') {
    if (/^03\d{9}$/.test(digits)) digits = '92' + digits.slice(1);
    else if (/^3\d{9}$/.test(digits)) digits = '92' + digits;
  }
  if (digits.startsWith('92')) {
    // Pakistani mobile numbers: +92 3XX XXXXXXX
    return /^923\d{9}$/.test(digits) ? { ok: true, e164: '+' + digits } : { ok: false, error: 'invalid' };
  }
  if (!hasPlus && !ascii.startsWith('00')) return { ok: false, error: 'invalid' };
  return /^[1-9]\d{7,14}$/.test(digits) ? { ok: true, e164: '+' + digits } : { ok: false, error: 'invalid' };
}

/** +923001234567 -> 0300 1234567 (local display); other countries unchanged. */
export function formatPhone(e164: string): string {
  const m = /^\+92(3\d{2})(\d{7})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]}` : e164;
}
