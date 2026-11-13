export const ORDER_STATUSES = [
  'submitted',
  'checking',
  'needs_confirmation',
  'confirmed',
  'ready',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Allowed admin transitions. Delivered and cancelled are final. */
export const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  submitted: ['checking', 'needs_confirmation', 'confirmed', 'cancelled'],
  checking: ['needs_confirmation', 'confirmed', 'cancelled'],
  needs_confirmation: ['checking', 'confirmed', 'cancelled'],
  confirmed: ['ready', 'delivered', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Orders that count as sales in reports (cancelled excluded, unconfirmed excluded). */
export const FULFILLED_STATUSES: OrderStatus[] = ['confirmed', 'ready', 'delivered'];
/** Orders waiting for the owner. */
export const OPEN_STATUSES: OrderStatus[] = ['submitted', 'checking', 'needs_confirmation'];
/** Statuses after which approved quantities are locked and stock has been deducted. */
export const LOCKED_STATUSES: OrderStatus[] = ['confirmed', 'ready', 'delivered'];

export type LineStatus = 'pending' | 'available' | 'partial' | 'unavailable' | 'substituted' | 'added';

export function lineStatusFor(requested: number, approved: number): LineStatus {
  if (approved <= 0) return 'unavailable';
  if (approved >= requested) return 'available';
  return 'partial';
}
