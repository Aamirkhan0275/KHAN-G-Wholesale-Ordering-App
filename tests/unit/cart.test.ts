import { describe, expect, it } from 'vitest';
import { cartTotals, clampQty, setLineQty, MAX_LINE_QTY } from '../../shared/cart';

describe('cart', () => {
  it('clamps invalid quantities', () => {
    expect(clampQty(-5)).toBe(0);
    expect(clampQty(0)).toBe(0);
    expect(clampQty(2.7)).toBe(2);
    expect(clampQty('7')).toBe(7);
    expect(clampQty('abc')).toBe(0);
    expect(clampQty(NaN)).toBe(0);
    expect(clampQty(Infinity)).toBe(0);
    expect(clampQty(5000)).toBe(MAX_LINE_QTY);
  });
  it('plus/minus: setting 0 removes the line, otherwise updates in place', () => {
    let lines = setLineQty([], 'a', 1);
    lines = setLineQty(lines, 'b', 2);
    lines = setLineQty(lines, 'a', 3);
    expect(lines).toEqual([{ productId: 'a', qty: 3 }, { productId: 'b', qty: 2 }]);
    lines = setLineQty(lines, 'a', 0);
    expect(lines).toEqual([{ productId: 'b', qty: 2 }]);
    expect(setLineQty(lines, 'b', -1)).toEqual([]);
  });
  it('totals: units and price only when every line is priced', () => {
    const lines = [{ productId: 'a', qty: 3 }, { productId: 'b', qty: 2 }];
    expect(cartTotals(lines, (id) => (id === 'a' ? 100 : 250.5))).toEqual({ lines: 2, units: 5, total: 801 });
    expect(cartTotals(lines, (id) => (id === 'a' ? 100 : null))).toEqual({ lines: 2, units: 5, total: null });
    expect(cartTotals([], () => 1)).toEqual({ lines: 0, units: 0, total: null });
  });
});
