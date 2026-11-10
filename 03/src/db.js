import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  QUOTE_STATUSES,
  addDaysISO,
  clamp,
  computeTotals,
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
};

const DISCOUNT_TYPES = ['none', 'amount', 'percent'];

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
  };
}

function normalizeQuoteRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const status = QUOTE_STATUSES.includes(value.status) ? value.status : 'draft';
  const items = (Array.isArray(value.items) ? value.items : []).map(normalizeItem).filter(Boolean);
  const client = value.client && typeof value.client === 'object' ? value.client : {};
  return {
    id: text(value.id) || randomUUID(),
    number: text(value.number),
    status,
    issueDate: text(value.issueDate) || todayISO(),
    validUntil: text(value.validUntil) || addDaysISO(todayISO(), 14),
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
    terms: String(value.terms ?? ''),
    seller: value.seller && typeof value.seller === 'object'
      ? normalizeSettings(value.seller)
      : null,
    createdAt: text(value.createdAt) || new Date().toISOString(),
    updatedAt: text(value.updatedAt) || text(value.createdAt) || new Date().toISOString(),
  };
}

function normalizeData(value) {
  const source = value && typeof value === 'object' ? value : {};
  const quotes = (Array.isArray(source.quotes) ? source.quotes : [])
    .map(normalizeQuoteRecord)
    .filter(Boolean);
  return {
    settings: normalizeSettings(source.settings),
    quotes,
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

  const status = QUOTE_STATUSES.includes(input.status)
    ? input.status
    : (existing ? existing.status : 'draft');

  const items = [];
  const rawItems = Array.isArray(input.items) ? input.items : [];
  for (const raw of rawItems) {
    const description = text(raw && raw.description);
    const unit = text(raw && raw.unit);
    const hasQty = text(raw && raw.qty) !== '';
    const hasPrice = text(raw && raw.unitPrice) !== '';
    if (!description && !unit && !hasQty && !hasPrice) continue;
    if (!description) return fail('每個報價項目都需要填寫說明');

    const qty = toNumber(raw.qty, NaN);
    const unitPrice = toNumber(raw.unitPrice, NaN);
    if (!Number.isFinite(qty) || qty <= 0) {
      return fail(`項目「${description}」的數量必須大於 0`);
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return fail(`項目「${description}」的單價不可小於 0`);
    }
    if (qty > 1000000) return fail(`項目「${description}」的數量過大`);
    if (unitPrice > 1000000000) return fail(`項目「${description}」的單價過大`);

    items.push({
      description,
      qty: round(qty, 2),
      unit,
      unitPrice: round(unitPrice, 2),
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
    client,
    projectName,
    items,
    discountType,
    discountValue: round(discountValue, 2),
    taxRate,
    deposit: totals.deposit,
    notes: String(input.notes ?? ''),
    terms: String(input.terms ?? ''),
    seller: existing && existing.seller ? existing.seller : { ...settings },
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  return { ok: true, quote };
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

  function getQuotes({ status = '', q = '' } = {}) {
    const needle = text(q).toLowerCase();
    return data.quotes
      .filter((quote) => !status || quote.status === status)
      .filter((quote) => {
        if (!needle) return true;
        return [
          quote.number,
          quote.client.name,
          quote.client.contact,
          quote.projectName,
          ...quote.items.map((item) => item.description),
        ].join(' ').toLowerCase().includes(needle);
      })
      .sort((a, b) => (
        b.issueDate.localeCompare(a.issueDate)
        || b.createdAt.localeCompare(a.createdAt)
      ));
  }

  function createQuote(input = {}) {
    const result = sanitizeQuote(input, { settings: data.settings });
    if (!result.ok) return result;

    // Re-number against the current collection so concurrent creations never clash.
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
    const result = sanitizeQuote(input, {
      settings: data.settings,
      existing: data.quotes[index],
    });
    if (!result.ok) return result;
    data.quotes[index] = result.quote;
    persist();
    return result;
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
    clone.seller = { ...data.settings };
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
    const sum = (list) => list.reduce((total, row) => total + row.totals.total, 0);

    const active = rows.filter((row) => row.quote.status !== 'declined');
    const accepted = rows.filter((row) => row.quote.status === 'accepted');
    const declined = rows.filter((row) => row.quote.status === 'declined');
    const sent = rows.filter((row) => row.quote.status === 'sent');
    const draft = rows.filter((row) => row.quote.status === 'draft');
    const closed = accepted.length + declined.length;

    return {
      count: rows.length,
      quotedTotal: sum(active),
      acceptedTotal: sum(accepted),
      sentTotal: sum(sent),
      draftTotal: sum(draft),
      acceptedCount: accepted.length,
      declinedCount: declined.length,
      sentCount: sent.length,
      draftCount: draft.length,
      winRate: closed > 0 ? round((accepted.length / closed) * 100, 1) : 0,
    };
  }

  function exportData() {
    return {
      app: 'quotedesk',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: getSettings(),
      quotes: data.quotes,
    };
  }

  return {
    getSettings,
    updateSettings,
    getQuoteById,
    getQuotes,
    createQuote,
    updateQuote,
    duplicateQuote,
    setQuoteStatus,
    deleteQuote,
    getStats,
    exportData,
  };
}
