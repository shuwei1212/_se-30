import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysISO,
  calcPricing,
  computeTotals,
  nextQuoteNumber,
  toChineseAmount,
} from '../src/domain.js';

test('Chinese uppercase amount handles common invoice values', () => {
  const cases = [
    [0, '零元整'],
    [1, '壹元整'],
    [10, '壹拾元整'],
    [100, '壹佰元整'],
    [1001, '壹仟零壹元整'],
    [1010, '壹仟零壹拾元整'],
    [10000, '壹萬元整'],
    [10010, '壹萬零壹拾元整'],
    [11000, '壹萬壹仟元整'],
    [100000001, '壹億零壹元整'],
    [1000000000000, '壹兆元整'],
    [1234.56, '壹仟貳佰參拾肆元伍角陸分整'],
    [100.05, '壹佰元零伍分整'],
    [100.5, '壹佰元伍角整'],
    [-12, '負壹拾貳元整'],
  ];
  for (const [value, expected] of cases) {
    assert.equal(toChineseAmount(value), expected, `value=${value}`);
  }
});

test('computeTotals applies discount, tax and deposit correctly', () => {
  const totals = computeTotals({
    items: [
      { qty: 2, unitPrice: 1000 },
      { qty: 1, unitPrice: 500.5 },
    ],
    discountType: 'percent',
    discountValue: 10,
    taxRate: 5,
    deposit: 500,
  });
  assert.equal(totals.subtotal, 2501);
  assert.equal(totals.discount, 250);
  assert.equal(totals.afterDiscount, 2251);
  assert.equal(totals.tax, 113);
  assert.equal(totals.total, 2364);
  assert.equal(totals.deposit, 500);
  assert.equal(totals.balance, 1864);
});

test('computeTotals clamps a fixed discount and an oversized deposit', () => {
  const totals = computeTotals({
    items: [{ qty: 1, unitPrice: 1000 }],
    discountType: 'amount',
    discountValue: 5000,
    taxRate: 0,
    deposit: 9999,
  });
  assert.equal(totals.subtotal, 1000);
  assert.equal(totals.discount, 1000);
  assert.equal(totals.total, 0);
  assert.equal(totals.deposit, 0);
  assert.equal(totals.balance, 0);
});

test('nextQuoteNumber keeps a daily sequence', () => {
  const quotes = [
    { number: 'Q20261110-001' },
    { number: 'Q20261110-003' },
    { number: 'Q20261001-009' },
  ];
  assert.equal(nextQuoteNumber(quotes, '2026-11-10', 'Q'), 'Q20261110-004');
  assert.equal(nextQuoteNumber([], '2026-11-10', 'Q'), 'Q20261110-001');
});

test('date helpers add days across month boundaries', () => {
  assert.equal(addDaysISO('2026-11-10', 14), '2026-11-24');
  assert.equal(addDaysISO('2026-01-30', 3), '2026-02-02');
});

test('calcPricing builds a defensible quote', () => {
  const result = calcPricing({
    hours: 40,
    hourlyRate: 1000,
    otherCost: 0,
    overheadRate: 10,
    contingencyRate: 10,
    profitRate: 20,
    taxRate: 5,
  });
  assert.equal(result.labor, 40000);
  assert.equal(result.overhead, 4000);
  assert.equal(result.contingency, 4400);
  assert.equal(result.cost, 48400);
  assert.equal(result.profit, 9680);
  assert.equal(result.beforeTax, 58080);
  assert.equal(result.tax, 2904);
  assert.equal(result.total, 60984);
  assert.equal(result.margin, 16.7);
  assert.equal(result.effectiveHourly, 1525);
});
