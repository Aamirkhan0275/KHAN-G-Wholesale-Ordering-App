import { z } from 'zod';
import { bad } from './errors.js';
import { UUID_RE } from '../context.js';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw bad('invalid_input', { field: issue?.path.join('.'), message: issue?.message });
  }
  return r.data;
}

export function uuidParam(v: string | undefined): string {
  if (!v || !UUID_RE.test(v)) throw bad('invalid_id');
  return v.toLowerCase();
}

export const zUuid = z.string().regex(UUID_RE);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const zMoney = z.number().finite().min(0).max(99_999_999);
export const zText = (max: number) => z.string().trim().max(max);
export const zOptText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
