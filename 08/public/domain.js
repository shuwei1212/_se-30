// Shared, browser-safe domain logic.
// The Node server and the browser both import this file, so the preview and
// the authoritative server calculation can never drift apart.

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined'];

export const STATUS_LABELS = {
  draft: '草稿',
  sent: '已送出',
  accepted: '已成交',
  declined: '已婉拒',
};

export const DISCOUNT_LABELS = {
  none: '無折扣',
  amount: '折抵金額',
  percent: '百分比折扣',
};

export const FOLLOW_UP_LABELS = {
  none: '未設定',
  later: '待追蹤',
  soon: '7 天內',
  overdue: '已逾期',
  closed: '已結案',
};

const DIGITS = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
const SMALL_UNITS = ['', '拾', '佰', '仟'];
const BIG_UNITS = ['', '萬', '億', '兆'];

export function toNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const text = value.trim().replace(/,/g, '');
    if (text === '') return fallback;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(toNumber(value), min), max);
}

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function formatMoney(value, currency = 'NT$') {
  const amount = round(value);
  const sign = amount < 0 ? '-' : '';
  const text = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${currency} ${text}`;
}

export function formatPercent(value, digits = 1) {
  return `${round(value, digits)}%`;
}

export function formatDate(value) {
  const date = parseISODate(value);
  if (!date) return String(value || '');
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
}

export function parseISODate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null;
  return date;
}

export function isValidISODate(value) {
  return Boolean(parseISODate(value));
}

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function addDaysISO(iso, days) {
  const date = parseISODate(iso) || new Date();
  date.setDate(date.getDate() + Math.trunc(toNumber(days)));
  return todayISO(date);
}

export function daysBetweenISO(from, to) {
  const start = parseISODate(from);
  const end = parseISODate(to);
  if (!start || !end) return 0;
  const startUTC = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUTC = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUTC - startUTC) / 86400000);
}

export function isFollowUpOpen(quote) {
  return Boolean(quote) && quote.status !== 'accepted' && quote.status !== 'declined';
}

export function followUpState(quote, today = todayISO()) {
  if (!quote) return 'none';
  if (quote.status === 'accepted' || quote.status === 'declined') return 'closed';
  if (!isValidISODate(quote.followUpDate)) return 'none';
  if (quote.followUpDate < today) return 'overdue';
  if (daysBetweenISO(today, quote.followUpDate) <= 7) return 'soon';
  return 'later';
}

function dateStamp(value) {
  const date = value instanceof Date ? value : (parseISODate(value) || new Date());
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

export function nextQuoteNumber(quotes = [], date = new Date(), prefix = 'Q') {
  const cleanPrefix = String(prefix || 'Q').trim() || 'Q';
  const base = `${cleanPrefix}${dateStamp(date)}-`;
  let max = 0;
  for (const quote of Array.isArray(quotes) ? quotes : []) {
    const number = String(quote && quote.number ? quote.number : '');
    if (!number.startsWith(base)) continue;
    const sequence = Number(number.slice(base.length));
    if (Number.isInteger(sequence) && sequence > max) max = sequence;
  }
  return `${base}${String(max + 1).padStart(3, '0')}`;
}

export function computeTotals(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const rows = items.map((item) => {
    const qty = Math.max(0, toNumber(item && item.qty));
    const unitPrice = Math.max(0, toNumber(item && item.unitPrice));
    const unitCost = Math.max(0, toNumber(item && (item.unitCost ?? item.cost)));
    const amount = round(qty * unitPrice);
    const cost = round(qty * unitCost);
    return {
      description: String((item && item.description) ?? ''),
      unit: String((item && item.unit) ?? ''),
      qty,
      unitPrice,
      unitCost,
      amount,
      cost,
      profit: amount - cost,
    };
  });

  const subtotal = rows.reduce((sum, row) => sum + row.amount, 0);

  const rawDiscount = Math.max(0, toNumber(input.discountValue));
  let discount = 0;
  if (input.discountType === 'percent') {
    discount = round(subtotal * Math.min(rawDiscount, 100) / 100);
  } else if (input.discountType === 'amount') {
    discount = Math.min(round(rawDiscount), subtotal);
  }

  const afterDiscount = subtotal - discount;
  const taxRate = clamp(input.taxRate, 0, 100);
  const tax = round(afterDiscount * taxRate / 100);
  const total = afterDiscount + tax;
  const deposit = Math.min(Math.max(0, round(toNumber(input.deposit))), total);
  const costTotal = rows.reduce((sum, row) => sum + row.cost, 0);
  const grossProfit = afterDiscount - costTotal;
  const margin = afterDiscount > 0 ? round((grossProfit / afterDiscount) * 100, 1) : 0;

  const payments = Array.isArray(input.payments) ? input.payments : [];
  const paidTotal = round(payments.reduce(
    (sum, payment) => sum + Math.max(0, toNumber(payment && payment.amount)),
    0,
  ));
  const balanceDue = Math.max(0, round(total - paidTotal));
  const overpaid = Math.max(0, round(paidTotal - total));

  return {
    rows,
    subtotal,
    discount,
    afterDiscount,
    taxRate,
    tax,
    total,
    deposit,
    balance: total - deposit,
    costTotal,
    grossProfit,
    margin,
    paidTotal,
    balanceDue,
    overpaid,
  };
}

function sectionToChinese(section) {
  let out = '';
  let unitIndex = 0;
  let pendingZero = false;
  let rest = section;

  while (rest > 0) {
    const digit = rest % 10;
    if (digit === 0) {
      if (out.length > 0) pendingZero = true;
    } else {
      if (pendingZero) {
        out = `零${out}`;
        pendingZero = false;
      }
      out = `${DIGITS[digit]}${SMALL_UNITS[unitIndex]}${out}`;
    }
    rest = Math.floor(rest / 10);
    unitIndex += 1;
  }

  return out;
}

function integerToChinese(value) {
  let rest = Math.floor(Math.abs(value));
  if (rest === 0) return '零';

  const groups = [];
  while (rest > 0) {
    groups.push(rest % 10000);
    rest = Math.floor(rest / 10000);
  }

  let out = '';
  let pendingZero = false;
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i];
    if (group === 0) {
      if (out.length > 0) pendingZero = true;
      continue;
    }
    if (out.length > 0 && (pendingZero || group < 1000)) {
      out += '零';
    }
    out += `${sectionToChinese(group)}${BIG_UNITS[i] || ''}`;
    pendingZero = false;
  }
  return out;
}

// Traditional Chinese uppercase (financial) amount, e.g. 1234.56 ->
// 壹仟貳佰參拾肆元伍角陸分整
export function toChineseAmount(value) {
  const centsTotal = Math.round(toNumber(value) * 100);
  if (centsTotal === 0) return '零元整';

  const sign = centsTotal < 0 ? '負' : '';
  const cents = Math.abs(centsTotal);
  const integer = Math.floor(cents / 100);
  const rest = cents % 100;
  const jiao = Math.floor(rest / 10);
  const fen = rest % 10;

  const out = `${sign}${integerToChinese(integer)}元`;
  if (rest === 0) return `${out}整`;
  if (fen === 0) return `${out}${DIGITS[jiao]}角整`;
  if (jiao === 0) return `${out}零${DIGITS[fen]}分整`;
  return `${out}${DIGITS[jiao]}角${DIGITS[fen]}分整`;
}

export function calcPricing(input = {}) {
  const hours = Math.max(0, toNumber(input.hours));
  const hourlyRate = Math.max(0, toNumber(input.hourlyRate));
  const otherCost = Math.max(0, toNumber(input.otherCost));
  const overheadRate = clamp(input.overheadRate, 0, 100);
  const contingencyRate = clamp(input.contingencyRate, 0, 100);
  const profitRate = clamp(input.profitRate, 0, 95);
  const taxRate = clamp(input.taxRate, 0, 100);

  const labor = round(hours * hourlyRate);
  const direct = labor + round(otherCost);
  const overhead = round(direct * overheadRate / 100);
  const contingency = round((direct + overhead) * contingencyRate / 100);
  const cost = direct + overhead + contingency;
  const profit = round(cost * profitRate / 100);
  const beforeTax = cost + profit;
  const tax = round(beforeTax * taxRate / 100);
  const total = beforeTax + tax;
  const margin = beforeTax > 0 ? round((profit / beforeTax) * 100, 1) : 0;
  const effectiveHourly = hours > 0 ? round(total / hours) : 0;

  return {
    hours,
    hourlyRate,
    otherCost: round(otherCost),
    overheadRate,
    contingencyRate,
    profitRate,
    taxRate,
    labor,
    direct,
    overhead,
    contingency,
    cost,
    profit,
    beforeTax,
    tax,
    total,
    margin,
    effectiveHourly,
  };
}
