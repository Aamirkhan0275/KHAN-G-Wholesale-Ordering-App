import { z } from 'zod';
import { bad } from './errors.js';
import { normalizeCnic, normalizePhone } from '../../shared/phone.js';
import { zOptText } from './validate.js';

/** Extra customer (shop) details the owner can record. All optional. */
export const customerDetailsShape = {
  city: zOptText(60).optional(),
  area: zOptText(80).optional(),
  alternate_phone: z.string().max(40).nullish(),
  whatsapp_phone: z.string().max(40).nullish(),
  email: z.string().trim().max(120).nullish(),
  cnic: z.string().max(20).nullish(),
  ntn: zOptText(20).optional(),
  shop_type: zOptText(40).optional(),
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Validates/normalizes the optional details; returns only keys that were sent. */
export function customerDetailsPatch(b: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['city', 'area', 'ntn', 'shop_type'] as const) if (b[k] !== undefined) out[k] = b[k] || null;
  for (const k of ['alternate_phone', 'whatsapp_phone'] as const) {
    if (b[k] === undefined) continue;
    if (!b[k]) { out[k] = null; continue; }
    const p = normalizePhone(b[k]);
    if (!p.ok) throw bad(`invalid_${k}`);
    out[k] = p.e164;
  }
  if (b.email !== undefined) {
    if (!b.email) out.email = null;
    else if (!EMAIL_RE.test(b.email)) throw bad('invalid_email');
    else out.email = String(b.email).toLowerCase();
  }
  if (b.cnic !== undefined) {
    if (!b.cnic) out.cnic = null;
    else {
      const c = normalizeCnic(b.cnic);
      if (!c.ok) throw bad('invalid_cnic');
      out.cnic = c.value;
    }
  }
  return out;
}

export const CUSTOMER_FIELDS = ['city', 'area', 'alternate_phone', 'whatsapp_phone', 'email', 'cnic', 'ntn', 'shop_type'] as const;
