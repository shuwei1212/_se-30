import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  QUOTE_STATUSES,
  STATUS_LABELS,
  addDaysISO,
  clamp,
  computeTotals,
  followUpState,
  isFollowUpOpen,
  nextQuoteNumber,
  parseISODate,
  round,
  todayISO,
  toNumber,
} from './domain.js';
import { createSeed } from './seed.js';

export const DEFAULT_SETTINGS = {
  companyName: '',
  companyTaxId: '',
  companyPhone: '',
  companyEmail: '',
  companyAddress: '',
  bankInfo: '',
  defaultTaxRate: 5,
  quotePrefix: 'Q',
  defaultTerms: '',
  lowMarginThreshold: 20,
  followUpDays: 7,
};

const DISCOUNT_TYPES = ['none', 'amount', 'percent'];
const REVISION_LIMIT = 20;

function text(value) {
  return String(value ?? '').trim();
}

function fail(message) {
  return { ok: false, error: message };
}

function normalizeSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    companyName: text(source.companyName),
    companyTaxId: text(source.companyTaxId),
    companyPhone: text(source.companyPhone),
    companyEmail: text(source.companyEmail),
    companyAddress: text(source.companyAddress),
    bankInfo: text(source.bankInfo),
    defaultTaxRate: clamp(
      source.defaultTaxRate == null ? DEFAULT_SETTINGS.defaultTaxRate : source.defaultTaxRate,
      0,
      100,
    ),
    quotePrefix: text(source.quotePrefix).slice(0, 8) || DEFAULT_SETTINGS.quotePrefix,
    defaultTerms: String(source.defaultTerms ?? ''),
    lowMarginThreshold: clamp(
      source.lowMarginThreshold == null
        ? DEFAULT_SETTINGS.lowMarginThreshold
        : source.lowMarginThreshold,
      0,
      100,
    ),
    followUpDays: clamp(
      source.followUpDays == null ? DEFAULT_SETTINGS.followUpDays : source.followUpDays,
      0,
      365,
    ),
  };
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const description = text(item.description);
  if (!description) return null;
  return {
    description,
    qty: Math.max(0, toNumber(item.qty)),
    unit: text(item.unit),
    unitPrice: Math.max(0, toNumber(item.unitPrice)),
    unitCost: Math.max(0, toNumber(item.unitCost ?? item.cost)),
  };
}

function normalizePayment(value) {
  if (!value || typeof value !== 'object') return null;
  const amount = round(toNumber(value.amount), 2);
  const date = text(value.date);
  if (amount <= 0 || !parseISODate(date)) return null;
  return {
    id: text(value.id) || randomUUID(),
    date,
    amount,
    method: text(value.method),
    note: String(value.note ?? ''),
    createdAt: text(value.createdAt) || new Date().toISOString(),
  };
}

function normalizeQuoteRecord(value, { withHistory = true } = {}) {
  if (!value || typeof value !== 'object') return null;
  const status = QUOTE_STATUSES.includes(value.status) ? value.status : 'draft';
  const items = (Array.isArray(value.items) ? value.items : []).map(normalizeItem).filter(Boolean);
  const client = value.client && typeof value.client === 'object' ? value.client : {};
  const followUpDate = text(value.followUpDate);

  const revisions = withHistory && Array.isArray(value.revisions)
    ? value.revisions.map(normalizeRevision).filter(Boolean)
    : [];

  return {
    id: text(value.id) || randomUUID(),
    number: text(value.number),
    status,
    issueDate: text(value.issueDate) || todayISO(),
    validUntil: text(value.validUntil) || addDaysISO(todayISO(), 14),
    followUpDate: parseISODate(followUpDate) ? followUpDate : '',
    followUpNote: String(value.followUpNote ?? ''),
    client: {
      name: text(client.name),
      contact: text(client.contact),
      phone: text(client.phone),
      email: text(client.email),
      address: text(client.address),
      taxId: text(client.taxId),
    },
    projectName: text(value.projectName),
    items,
    discountType: DISCOUNT_TYPES.includes(value.discountType) ? value.discountType : 'none',
    discountValue: Math.max(0, toNumber(value.discountValue)),
    taxRate: clamp(value.taxRate, 0, 100),
    deposit: Math.max(0, toNumber(value.deposit)),
    notes: String(value.notes ?? ''),
    internalNotes: String(value.internalNotes ?? ''),
    terms: String(value.terms ?? ''),
    seller: value.seller && typeof value.seller === 'object'
      ? normalizeSettings(value.seller)
      : null,
    payments: (Array.isArray(value.payments) ? value.payments : [])
      .map(normalizePayment)
      .filter(Boolean),
    revisions,
    statusChangedAt: text(value.statusChangedAt) || text(value.updatedAt) || '',
    createdAt: text(value.createdAt) || new Date().toISOString(),
    updatedAt: text(value.updatedAt) || text(value.createdAt) || new Date().toISOString(),
  };
}

function normalizeRevision(value) {
  if (!value || typeof value !== 'object' || !value.snapshot) return null;
  const snapshot = normalizeQuoteRecord(value.snapshot, { withHistory: false });
  if (!snapshot) return null;
  return {
    id: text(value.id) || randomUUID(),
    at: text(value.at) || new Date().toISOString(),
    reason: text(value.reason) || '版本紀錄',
    snapshot,
  };
}

function normalizeData(value) {
  const source = value && typeof value === 'object' ? value : {};
  const quotes = (Array.isArray(source.quotes) ? source.quotes : [])
    .map((quote) => normalizeQuoteRecord(quote))
    .filter(Boolean);
  return {
    settings: normalizeSettings(source.settings),
    quotes,
  };
}

function snapshotForRevision(quote) {
  const copy = JSON.parse(JSON.stringify(quote));
  copy.revisions = [];
  copy.payments = [];
  return copy;
}

function makeRevision(quote, reason) {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    reason,
    snapshot: snapshotForRevision(quote),
  };
}

function sanitizeQuote(input = {}, { settings, existing = null } = {}) {
  const clientInput = input.client && typeof input.client === 'object' ? input.client : {};
  const client = {
    name: text(clientInput.name),
    contact: text(clientInput.contact),
    phone: text(clientInput.phone),
    email: text(clientInput.email),
    address: text(clientInput.address),
    taxId: text(clientInput.taxId),
  };
  if (!client.name) return fail('請填寫客戶名稱');

  const projectName = text(input.projectName);
  if (!projectName) return fail('請填寫專案名稱');

  let issueDate = text(input.issueDate);
  if (issueDate) {
    if (!parseISODate(issueDate)) return fail('報價日期格式不正確');
  } else {
    issueDate = todayISO();
  }

  let validUntil = text(input.validUntil);
  if (validUntil) {
    if (!parseISODate(validUntil)) return fail('有效期限格式不正確');
  } else {
    validUntil = addDaysISO(issueDate, 14);
  }
  if (validUntil < issueDate) return fail('有效期限不可早於報價日期');

  let followUpDate = text(input.followUpDate);
  if (followUpDate && !parseISODate(followUpDate)) return fail('追蹤日期格式不正確');
  if (!followUpDate) followUpDate = addDaysISO(issueDate, settings.followUpDays);

  const status = QUOTE_STATUSES.includes(input.status)
    ? input.status
    : (existing ? existing.status : 'draft');

  const items = [];
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length > 200) return fail('報價項目不可超過 200 筆');
  for (const raw of rawItems) {
    const description = text(raw && raw.description);
    const unit = text(raw && raw.unit);
    const hasQty = text(raw && raw.qty) !== '';
    const hasPrice = text(raw && raw.unitPrice) !== '';
    const hasCost = text(raw && raw.unitCost) !== '';
    if (!description && !unit && !hasQty && !hasPrice && !hasCost) continue;
    if (!description) return fail('每個報價項目都需要填寫說明');

    const qty = toNumber(raw.qty, NaN);
    const unitPrice = toNumber(raw.unitPrice, NaN);
    const unitCost = hasCost ? toNumber(raw.unitCost, NaN) : 0;
    if (!Number.isFinite(qty) || qty <= 0) {
      return fail(`項目「${description}」的數量必須大於 0`);
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return fail(`項目「${description}」的單價不可小於 0`);
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      return fail(`項目「${description}」的內部成本不可小於 0`);
    }
    if (qty > 1000000) return fail(`項目「${description}」的數量過大`);
    if (unitPrice > 1000000000) return fail(`項目「${description}」的單價過大`);
    if (unitCost > 1000000000) return fail(`項目「${description}」的內部成本過大`);

    items.push({
      description,
      qty: round(qty, 2),
      unit,
      unitPrice: round(unitPrice, 2),
      unitCost: round(unitCost, 2),
    });
  }
  if (items.length === 0) return fail('請至少新增一個報價項目');

  const discountType = DISCOUNT_TYPES.includes(input.discountType)
    ? input.discountType
    : 'none';
  let discountValue = Math.max(0, toNumber(input.discountValue));
  if (discountType === 'percent' && discountValue > 100) {
    return fail('折扣百分比不可超過 100%');
  }
  if (discountType === 'none') discountValue = 0;

  const rawTaxRate = text(input.taxRate);
  const taxRate = rawTaxRate === ''
    ? settings.defaultTaxRate
    : toNumber(rawTaxRate, NaN);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    return fail('營業稅率必須介於 0 到 100%');
  }

  const deposit = Math.max(0, toNumber(input.deposit));
  const totals = computeTotals({ items, discountType, discountValue, taxRate, deposit });

  const now = new Date().toISOString();
  const quote = {
    id: existing ? existing.id : randomUUID(),
    number: existing ? existing.number : nextQuoteNumber([], issueDate, settings.quotePrefix),
    status,
    issueDate,
    validUntil,
    followUpDate,
    followUpNote: String(input.followUpNote ?? ''),
    client,
    projectName,
    items,
    discountType,
    discountValue: round(discountValue, 2),
    taxRate,
    deposit: totals.deposit,
    notes: String(input.notes ?? ''),
    internalNotes: String(input.internalNotes ?? ''),
    terms: String(input.terms ?? ''),
    seller: existing && existing.seller ? existing.seller : { ...settings },
    payments: existing ? existing.payments : [],
    revisions: existing ? existing.revisions : [],
    statusChangedAt: existing && existing.status === status
      ? existing.statusChangedAt
      : now,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  return { ok: true, quote };
}

function csvCell(value) {
  let raw = String(value ?? '');
  if (/^[=+\-@]/.test(raw)) raw = `'${raw}`;
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function createStore(file, options = {}) {
  const seed = options.seed || createSeed();
  let data;

  function persist() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  if (file && fs.existsSync(file)) {
    data = normalizeData(JSON.parse(fs.readFileSync(file, 'utf8')));
  } else {
    data = normalizeData(seed);
    persist();
  }

  function getSettings() {
    return { ...data.settings };
  }

  function updateSettings(input = {}) {
    data.settings = normalizeSettings({ ...data.settings, ...input });
    persist();
    return { ok: true, settings: getSettings() };
  }

  function getQuoteById(id) {
    return data.quotes.find((quote) => quote.id === id) || null;
  }

  function getQuotes({ status = '', q = '', followUp = '' } = {}) {
    const needle = text(q).toLowerCase();
    let quotes = data.quotes
      .filter((quote) => !status || quote.status === status)
      .filter((quote) => {
        if (!needle) return true;
        return [
          quote.number,
          quote.client.name,
          quote.client.contact,
          quote.projectName,
          quote.followUpNote,
          ...quote.items.map((item) => item.description),
        ].join(' ').toLowerCase().includes(needle);
      });

    if (followUp === 'overdue') {
      quotes = quotes.filter((quote) => followUpState(quote) === 'overdue');
    } else if (followUp === 'soon') {
      quotes = quotes.filter((quote) => followUpState(quote) === 'soon');
    } else if (followUp === 'attention') {
      quotes = quotes.filter((quote) => ['overdue', 'soon'].includes(followUpState(quote)));
    } else if (followUp === 'open') {
      quotes = quotes.filter((quote) => isFollowUpOpen(quote));
    }

    if (followUp) {
      return quotes.sort((a, b) => (
        (a.followUpDate || '9999-12-31').localeCompare(b.followUpDate || '9999-12-31')
        || b.issueDate.localeCompare(a.issueDate)
      ));
    }

    return quotes.sort((a, b) => (
      b.issueDate.localeCompare(a.issueDate)
      || b.createdAt.localeCompare(a.createdAt)
    ));
  }

  function createQuote(input = {}) {
    const result = sanitizeQuote(input, { settings: data.settings });
    if (!result.ok) return result;

    result.quote.number = nextQuoteNumber(
      data.quotes,
      result.quote.issueDate,
      data.settings.quotePrefix,
    );
    data.quotes.push(result.quote);
    persist();
    return result;
  }

  function updateQuote(id, input = {}) {
    const index = data.quotes.findIndex((quote) => quote.id === id);
    if (index === -1) return fail('找不到這份報價單');
    const existing = data.quotes[index];
    const result = sanitizeQuote(input, {
      settings: data.settings,
      existing,
    });
    if (!result.ok) return result;

    result.quote.revisions = [
      makeRevision(existing, '更新前版本'),
      ...(existing.revisions || []),
    ].slice(0, REVISION_LIMIT);
    result.quote.payments = existing.payments || [];
    data.quotes[index] = result.quote;
    persist();
    return result;
  }

  function restoreRevision(id, revisionId) {
    const index = data.quotes.findIndex((quote) => quote.id === id);
    if (index === -1) return fail('找不到這份報價單');
    const current = data.quotes[index];
    const revision = (current.revisions || []).find((row) => row.id === revisionId);
    if (!revision) return fail('找不到這個版本');

    const restored = JSON.parse(JSON.stringify(revision.snapshot));
    restored.id = current.id;
    restored.number = current.number;
    restored.payments = current.payments || [];
    restored.revisions = [
      makeRevision(current, '還原前版本'),
      ...(current.revisions || []),
    ].slice(0, REVISION_LIMIT);
    restored.updatedAt = new Date().toISOString();
    restored.statusChangedAt = restored.statusChangedAt || restored.updatedAt;
    data.quotes[index] = normalizeQuoteRecord(restored);
    persist();
    return { ok: true, quote: data.quotes[index] };
  }

  function duplicateQuote(id, now = new Date()) {
    const source = getQuoteById(id);
    if (!source) return fail('找不到這份報價單');
    const issueDate = todayISO(now);
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = randomUUID();
    clone.number = nextQuoteNumber(data.quotes, issueDate, data.settings.quotePrefix);
    clone.status = 'draft';
    clone.issueDate = issueDate;
    clone.validUntil = addDaysISO(issueDate, 14);
    clone.followUpDate = addDaysISO(issueDate, data.settings.followUpDays);
    clone.followUpNote = '';
    clone.internalNotes = '';
    clone.seller = { ...data.settings };
    clone.payments = [];
    clone.revisions = [];
    clone.statusChangedAt = now.toISOString();
    clone.createdAt = now.toISOString();
    clone.updatedAt = now.toISOString();
    data.quotes.push(clone);
    persist();
    return { ok: true, quote: clone };
  }

  function setQuoteStatus(id, status) {
    if (!QUOTE_STATUSES.includes(status)) return fail('報價狀態不正確');
    const quote = getQuoteById(id);
    if (!quote) return fail('找不到這份報價單');
    quote.status = status;
    quote.statusChangedAt = new Date().toISOString();
    quote.updatedAt = quote.statusChangedAt;
    persist();
    return { ok: true, quote };
  }

  function addPayment(id, input = {}) {
    const quote = getQuoteById(id);
    if (!quote) return fail('找不到這份報價單');
    if (quote.status === 'declined') return fail('已婉拒的報價單不能登記收款');

    const amount = round(toNumber(input.amount), 2);
    if (!(amount > 0)) return fail('收款金額必須大於 0');

    const date = text(input.date) || todayISO();
    if (!parseISODate(date)) return fail('收款日期格式不正確');

    const totals = computeTotals(quote);
    if (totals.total <= 0) return fail('總計為 0 的報價單不能登記收款');
    if (totals.paidTotal + amount > totals.total) {
      return fail(`收款金額超過未收款金額 ${totals.balanceDue}`);
    }

    const now = new Date().toISOString();
    const payment = {
      id: randomUUID(),
      date,
      amount,
      method: text(input.method),
      note: String(input.note ?? ''),
      createdAt: now,
    };
    quote.payments = [...(quote.payments || []), payment];
    quote.updatedAt = now;
    persist();
    return { ok: true, quote, payment };
  }

  function removePayment(id, paymentId) {
    const quote = getQuoteById(id);
    if (!quote) return fail('找不到這份報價單');
    const index = (quote.payments || []).findIndex((payment) => payment.id === paymentId);
    if (index === -1) return fail('找不到這筆收款');
    quote.payments.splice(index, 1);
    quote.updatedAt = new Date().toISOString();
    persist();
    return { ok: true, quote };
  }

  function deleteQuote(id) {
    const index = data.quotes.findIndex((quote) => quote.id === id);
    if (index === -1) return fail('找不到這份報價單');
    const [removed] = data.quotes.splice(index, 1);
    persist();
    return { ok: true, quote: removed };
  }

  function getStats() {
    const rows = data.quotes.map((quote) => ({
      quote,
      totals: computeTotals(quote),
    }));
    const sum = (list, pick) => list.reduce((total, row) => total + pick(row), 0);

    const active = rows.filter((row) => row.quote.status !== 'declined');
    const accepted = rows.filter((row) => row.quote.status === 'accepted');
    const declined = rows.filter((row) => row.quote.status === 'declined');
    const sent = rows.filter((row) => row.quote.status === 'sent');
    const draft = rows.filter((row) => row.quote.status === 'draft');
    const closed = accepted.length + declined.length;
    const quotedTotal = sum(active, (row) => row.totals.total);
    const quotedRevenue = sum(active, (row) => row.totals.afterDiscount);
    const grossProfit = sum(active, (row) => row.totals.grossProfit);
    const acceptedTotal = sum(accepted, (row) => row.totals.total);
    const acceptedRevenue = sum(accepted, (row) => row.totals.afterDiscount);
    const acceptedProfit = sum(accepted, (row) => row.totals.grossProfit);
    const followUpRows = rows.filter((row) => (
      row.quote.status === 'sent'
      && ['overdue', 'soon'].includes(followUpState(row.quote))
    ));

    return {
      count: rows.length,
      quotedTotal,
      acceptedTotal,
      sentTotal: sum(sent, (row) => row.totals.total),
      draftTotal: sum(draft, (row) => row.totals.total),
      acceptedCount: accepted.length,
      declinedCount: declined.length,
      sentCount: sent.length,
      draftCount: draft.length,
      winRate: closed > 0 ? round((accepted.length / closed) * 100, 1) : 0,
      costTotal: sum(active, (row) => row.totals.costTotal),
      grossProfit,
      margin: quotedRevenue > 0 ? round((grossProfit / quotedRevenue) * 100, 1) : 0,
      acceptedCost: sum(accepted, (row) => row.totals.costTotal),
      acceptedProfit,
      acceptedMargin: acceptedRevenue > 0
        ? round((acceptedProfit / acceptedRevenue) * 100, 1)
        : 0,
      paidTotal: sum(rows, (row) => row.totals.paidTotal),
      receivable: sum(accepted, (row) => row.totals.balanceDue),
      followUpCount: followUpRows.length,
      overdueCount: followUpRows.filter((row) => followUpState(row.quote) === 'overdue').length,
      lowMarginCount: active.filter(
        (row) => row.totals.margin < data.settings.lowMarginThreshold,
      ).length,
    };
  }

  function exportData() {
    return {
      app: 'quotedesk-studio',
      version: 2,
      exportedAt: new Date().toISOString(),
      settings: getSettings(),
      quotes: data.quotes,
    };
  }

  function exportCsv() {
    const header = [
      '報價編號',
      '報價日期',
      '有效期限',
      '狀態',
      '客戶',
      '專案',
      '小計',
      '折扣',
      '稅額',
      '總計',
      '內部成本',
      '預估毛利',
      '毛利率',
      '已收款',
      '待收款',
      '追蹤日期',
    ];
    const rows = getQuotes().map((quote) => {
      const totals = computeTotals(quote);
      return [
        quote.number,
        quote.issueDate,
        quote.validUntil,
        STATUS_LABELS[quote.status] || quote.status,
        quote.client.name,
        quote.projectName,
        totals.subtotal,
        totals.discount,
        totals.tax,
        totals.total,
        totals.costTotal,
        totals.grossProfit,
        `${totals.margin}%`,
        totals.paidTotal,
        totals.balanceDue,
        quote.followUpDate || '',
      ];
    });
    return [
      header.map(csvCell).join(','),
      ...rows.map((row) => row.map(csvCell).join(',')),
    ].join('\n');
  }

  return {
    getSettings,
    updateSettings,
    getQuoteById,
    getQuotes,
    createQuote,
    updateQuote,
    restoreRevision,
    duplicateQuote,
    setQuoteStatus,
    addPayment,
    removePayment,
    deleteQuote,
    getStats,
    exportData,
    exportCsv,
  };
}
