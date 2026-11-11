import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addDaysISO,
  calcPricing,
  computeTotals,
  round,
  todayISO,
} from './domain.js';
import {
  dashboardPage,
  errorPage,
  pricingPage,
  quoteFormPage,
  quotesPage,
  quoteViewPage,
  settingsPage,
} from './views.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
};

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendHtml(res, status, html) {
  const buffer = Buffer.from(html, 'utf8');
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

function sendJson(res, status, value, headers = {}) {
  const buffer = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(buffer);
}

function sendCsv(res, csv, filename) {
  const buffer = Buffer.from(`\uFEFF${csv}`, 'utf8');
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Length': buffer.length,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

function redirect(res, location) {
  res.writeHead(302, {
    ...SECURITY_HEADERS,
    Location: location,
    'Content-Length': 0,
    'Cache-Control': 'no-store',
  });
  res.end();
}

function encodeFlash(res, location, ok, message) {
  const type = ok ? 'ok' : 'error';
  redirect(res, `${location}?msg=${encodeURIComponent(message)}&type=${type}`);
}

function buildFlash(query) {
  const message = query.get('msg');
  if (!message) return null;
  return {
    type: query.get('type') === 'error' ? 'error' : 'ok',
    message,
  };
}

function matchPath(pattern, pathname) {
  const expected = pattern.split('/').filter(Boolean);
  const actual = pathname.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i].startsWith(':')) {
      try {
        params[expected[i].slice(1)] = decodeURIComponent(actual[i]);
      } catch {
        return null;
      }
    } else if (expected[i] !== actual[i]) {
      return null;
    }
  }
  return params;
}

function readForm(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        const error = new Error('送出的內容過大');
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
  });
}

function parseQuoteForm(body) {
  const descriptions = body.getAll('itemDescription');
  const qtys = body.getAll('itemQty');
  const units = body.getAll('itemUnit');
  const prices = body.getAll('itemUnitPrice');
  const costs = body.getAll('itemUnitCost');
  const length = Math.max(
    descriptions.length,
    qtys.length,
    units.length,
    prices.length,
    costs.length,
  );
  const items = [];
  for (let i = 0; i < length; i += 1) {
    items.push({
      description: descriptions[i] ?? '',
      qty: qtys[i] ?? '',
      unit: units[i] ?? '',
      unitPrice: prices[i] ?? '',
      unitCost: costs[i] ?? '',
    });
  }
  return {
    client: {
      name: body.get('clientName') ?? '',
      contact: body.get('clientContact') ?? '',
      phone: body.get('clientPhone') ?? '',
      email: body.get('clientEmail') ?? '',
      address: body.get('clientAddress') ?? '',
      taxId: body.get('clientTaxId') ?? '',
    },
    projectName: body.get('projectName') ?? '',
    issueDate: body.get('issueDate') ?? '',
    validUntil: body.get('validUntil') ?? '',
    followUpDate: body.get('followUpDate') ?? '',
    followUpNote: body.get('followUpNote') ?? '',
    status: body.get('status') ?? 'draft',
    items,
    discountType: body.get('discountType') ?? 'none',
    discountValue: body.get('discountValue') ?? '0',
    taxRate: body.get('taxRate') ?? '',
    deposit: body.get('deposit') ?? '0',
    notes: body.get('notes') ?? '',
    internalNotes: body.get('internalNotes') ?? '',
    terms: body.get('terms') ?? '',
  };
}

function formModel(input, settings) {
  const issueDate = input.issueDate || todayISO();
  return {
    ...input,
    client: {
      name: '',
      contact: '',
      phone: '',
      email: '',
      address: '',
      taxId: '',
      ...(input.client || {}),
    },
    items: Array.isArray(input.items) ? input.items : [],
    issueDate,
    validUntil: input.validUntil || addDaysISO(issueDate, 14),
    followUpDate: input.followUpDate || addDaysISO(issueDate, settings.followUpDays),
    followUpNote: input.followUpNote ?? '',
    internalNotes: input.internalNotes ?? '',
    status: input.status || 'draft',
    discountType: input.discountType || 'none',
    discountValue: input.discountValue ?? 0,
    taxRate: input.taxRate === '' || input.taxRate == null
      ? settings.defaultTaxRate
      : input.taxRate,
    deposit: input.deposit ?? 0,
    notes: input.notes ?? '',
    terms: input.terms ?? settings.defaultTerms,
  };
}

function defaultPricingForm(settings) {
  return {
    hours: 40,
    hourlyRate: 1200,
    otherCost: 5000,
    overheadRate: 15,
    contingencyRate: 10,
    profitRate: 20,
    taxRate: settings.defaultTaxRate,
  };
}

function parsePricingForm(body, settings) {
  return {
    hours: body.get('hours') ?? '0',
    hourlyRate: body.get('hourlyRate') ?? '0',
    otherCost: body.get('otherCost') ?? '0',
    overheadRate: body.get('overheadRate') ?? '0',
    contingencyRate: body.get('contingencyRate') ?? '0',
    profitRate: body.get('profitRate') ?? '0',
    taxRate: body.get('taxRate') ?? String(settings.defaultTaxRate),
  };
}

export function createApp({ store, publicDir }) {
  if (!store) throw new TypeError('createApp: store is required');
  const staticRoot = publicDir
    || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

  function renderError(res, status, message) {
    if (res.headersSent) return;
    sendHtml(res, status, errorPage({ status, message }));
  }

  function serveStatic(res, file) {
    const resolvedRoot = path.resolve(staticRoot);
    const resolved = path.resolve(staticRoot, file);
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not found');
      return;
    }
    fs.readFile(resolved, (err, buffer) => {
      if (err) {
        res.writeHead(404, SECURITY_HEADERS);
        res.end('Not found');
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const type = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': type,
        'Content-Length': buffer.length,
        'Cache-Control': 'public, max-age=300',
      });
      res.end(buffer);
    });
  }

  function dashboardGet({ res, flash }) {
    const settings = store.getSettings();
    return sendHtml(res, 200, dashboardPage({
      settings,
      quotes: store.getQuotes(),
      stats: store.getStats(),
      flash,
    }));
  }

  function quotesGet({ res, query, flash }) {
    const q = (query.get('q') || '').trim();
    const status = query.get('status') || '';
    const followUp = query.get('followUp') || '';
    const settings = store.getSettings();
    return sendHtml(res, 200, quotesPage({
      quotes: store.getQuotes({ q, status, followUp }),
      q,
      status,
      followUp,
      settings,
      flash,
    }));
  }

  function quoteNewGet({ res, query, flash }) {
    const settings = store.getSettings();
    const draft = formModel({}, settings);
    const price = round(query.get('price'));
    if (price > 0) {
      draft.items = [{
        description: query.get('desc') || '專案報價（依工時與成本試算）',
        qty: 1,
        unit: '式',
        unitPrice: price,
      }];
    }
    const tax = round(query.get('tax'));
    if (query.has('tax') && tax >= 0 && tax <= 100) {
      draft.taxRate = tax;
    }
    return sendHtml(res, 200, quoteFormPage({
      quote: draft,
      settings,
      mode: 'new',
      flash,
    }));
  }

  function quoteCreatePost({ res, body }) {
    const settings = store.getSettings();
    const input = parseQuoteForm(body);
    const result = store.createQuote(input);
    if (!result.ok) {
      return sendHtml(res, 400, quoteFormPage({
        quote: formModel(input, settings),
        settings,
        mode: 'new',
        error: result.error,
      }));
    }
    return encodeFlash(res, `/quotes/${result.quote.id}`, true, '報價單已建立');
  }

  function quoteViewGet({ res, params, flash }) {
    const quote = store.getQuoteById(params.id);
    if (!quote) return renderError(res, 404, '找不到這份報價單');
    return sendHtml(res, 200, quoteViewPage({
      quote,
      settings: store.getSettings(),
      flash,
    }));
  }

  function quoteEditGet({ res, params, flash }) {
    const quote = store.getQuoteById(params.id);
    if (!quote) return renderError(res, 404, '找不到這份報價單');
    return sendHtml(res, 200, quoteFormPage({
      quote,
      settings: store.getSettings(),
      mode: 'edit',
      flash,
    }));
  }

  function quoteUpdatePost({ res, params, body }) {
    const existing = store.getQuoteById(params.id);
    if (!existing) return renderError(res, 404, '找不到這份報價單');
    const settings = store.getSettings();
    const input = parseQuoteForm(body);
    const result = store.updateQuote(params.id, input);
    if (!result.ok) {
      return sendHtml(res, 400, quoteFormPage({
        quote: { ...formModel(input, settings), id: existing.id, number: existing.number },
        settings,
        mode: 'edit',
        error: result.error,
      }));
    }
    return encodeFlash(res, `/quotes/${params.id}`, true, '報價單已更新');
  }

  function quoteDeletePost({ res, params }) {
    const result = store.deleteQuote(params.id);
    return encodeFlash(
      res,
      '/quotes',
      result.ok,
      result.ok ? '報價單已刪除' : result.error,
    );
  }

  function quoteDuplicatePost({ res, params }) {
    const result = store.duplicateQuote(params.id);
    if (!result.ok) return encodeFlash(res, '/quotes', false, result.error);
    return encodeFlash(res, `/quotes/${result.quote.id}`, true, '已複製為新的草稿');
  }

  function quoteStatusPost({ res, params, body }) {
    const result = store.setQuoteStatus(params.id, body.get('status') || '');
    return encodeFlash(
      res,
      `/quotes/${params.id}`,
      result.ok,
      result.ok ? '狀態已更新' : result.error,
    );
  }

  function paymentCreatePost({ res, params, body }) {
    const result = store.addPayment(params.id, {
      amount: body.get('amount'),
      date: body.get('date'),
      method: body.get('method'),
      note: body.get('note'),
    });
    return encodeFlash(
      res,
      `/quotes/${params.id}`,
      result.ok,
      result.ok ? '已登記收款' : result.error,
    );
  }

  function paymentDeletePost({ res, params }) {
    const result = store.removePayment(params.id, params.paymentId);
    return encodeFlash(
      res,
      `/quotes/${params.id}`,
      result.ok,
      result.ok ? '已刪除收款紀錄' : result.error,
    );
  }

  function revisionRestorePost({ res, params }) {
    const result = store.restoreRevision(params.id, params.revisionId);
    return encodeFlash(
      res,
      `/quotes/${params.id}`,
      result.ok,
      result.ok ? '已還原到指定版本' : result.error,
    );
  }

  function pricingGet({ res, flash }) {
    const settings = store.getSettings();
    const form = defaultPricingForm(settings);
    return sendHtml(res, 200, pricingPage({
      form,
      result: calcPricing(form),
      submitted: false,
      settings,
      flash,
    }));
  }

  function pricingPost({ res, body, flash }) {
    const settings = store.getSettings();
    const form = parsePricingForm(body, settings);
    return sendHtml(res, 200, pricingPage({
      form,
      result: calcPricing(form),
      submitted: true,
      settings,
      flash,
    }));
  }

  function settingsGet({ res, flash }) {
    return sendHtml(res, 200, settingsPage({
      settings: store.getSettings(),
      flash,
    }));
  }

  function settingsPost({ res, body }) {
    store.updateSettings({
      companyName: body.get('companyName'),
      companyTaxId: body.get('companyTaxId'),
      companyPhone: body.get('companyPhone'),
      companyEmail: body.get('companyEmail'),
      companyAddress: body.get('companyAddress'),
      bankInfo: body.get('bankInfo'),
      defaultTaxRate: body.get('defaultTaxRate'),
      quotePrefix: body.get('quotePrefix'),
      defaultTerms: body.get('defaultTerms'),
      lowMarginThreshold: body.get('lowMarginThreshold'),
      followUpDays: body.get('followUpDays'),
    });
    return encodeFlash(res, '/settings', true, '公司設定已儲存');
  }

  function exportGet({ res }) {
    const stamp = todayISO().replace(/-/g, '');
    sendJson(res, 200, store.exportData(), {
      'Content-Disposition': `attachment; filename="quotedesk-export-${stamp}.json"`,
    });
  }

  function exportCsvGet({ res }) {
    const stamp = todayISO().replace(/-/g, '');
    sendCsv(res, store.exportCsv(), `quotedesk-quotes-${stamp}.csv`);
  }

  function notFoundGet({ res }) {
    return renderError(res, 404, '找不到這個頁面');
  }

  const routes = [
    { method: 'GET', path: '/', handler: dashboardGet },
    { method: 'GET', path: '/quotes', handler: quotesGet },
    { method: 'GET', path: '/quotes/new', handler: quoteNewGet },
    { method: 'POST', path: '/quotes', handler: quoteCreatePost },
    { method: 'GET', path: '/quotes/:id', handler: quoteViewGet },
    { method: 'POST', path: '/quotes/:id', handler: quoteUpdatePost },
    { method: 'GET', path: '/quotes/:id/edit', handler: quoteEditGet },
    { method: 'POST', path: '/quotes/:id/delete', handler: quoteDeletePost },
    { method: 'POST', path: '/quotes/:id/duplicate', handler: quoteDuplicatePost },
    { method: 'POST', path: '/quotes/:id/status', handler: quoteStatusPost },
    { method: 'POST', path: '/quotes/:id/payments', handler: paymentCreatePost },
    { method: 'POST', path: '/quotes/:id/payments/:paymentId/delete', handler: paymentDeletePost },
    { method: 'POST', path: '/quotes/:id/revisions/:revisionId/restore', handler: revisionRestorePost },
    { method: 'GET', path: '/pricing', handler: pricingGet },
    { method: 'POST', path: '/pricing', handler: pricingPost },
    { method: 'GET', path: '/settings', handler: settingsGet },
    { method: 'POST', path: '/settings', handler: settingsPost },
    { method: 'GET', path: '/export', handler: exportGet },
    { method: 'GET', path: '/export.csv', handler: exportCsvGet },
    { method: 'GET', path: '/static/:file', handler: ({ res, params }) => serveStatic(res, params.file) },
    { method: 'GET', path: '/favicon.ico', handler: ({ res }) => { res.writeHead(204, SECURITY_HEADERS); res.end(); } },
    { method: 'GET', path: '/404', handler: notFoundGet },
  ];

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';

    let route = null;
    let params = {};
    for (const candidate of routes) {
      if (candidate.method !== method) continue;
      const matched = matchPath(candidate.path, url.pathname);
      if (matched) {
        route = candidate;
        params = matched;
        break;
      }
    }

    if (!route) return renderError(res, 404, '找不到這個頁面');

    let body = new URLSearchParams();
    if (method === 'POST') {
      try {
        body = await readForm(req);
      } catch (err) {
        return renderError(res, err.statusCode || 400, err.message);
      }
    }

    const ctx = {
      req,
      res,
      url,
      method,
      params,
      query: url.searchParams,
      body,
      flash: buildFlash(url.searchParams),
    };

    try {
      await route.handler(ctx);
    } catch (err) {
      console.error(err);
      renderError(res, 500, '伺服器發生錯誤');
    }
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, SECURITY_HEADERS);
        res.end('Internal Server Error');
      }
    });
  });
}
