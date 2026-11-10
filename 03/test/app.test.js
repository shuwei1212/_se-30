import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/db.js';
import { createApp } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let dir;
let server;
let base;

const SETTINGS = {
  companyName: '測試工作室',
  companyTaxId: '12345678',
  companyPhone: '0900-000-000',
  companyEmail: 'test@example.com',
  companyAddress: '測試地址',
  bankInfo: '測試銀行 123',
  defaultTaxRate: 5,
  quotePrefix: 'T',
  defaultTerms: '測試條款',
};

function buildSeed() {
  return {
    settings: { ...SETTINGS },
    quotes: [{
      id: 'test-quote-1',
      number: 'T20260101-001',
      status: 'sent',
      issueDate: '2026-01-01',
      validUntil: '2026-01-15',
      client: {
        name: '測試客戶',
        contact: '王先生',
        phone: '0900-111-222',
        email: 'client@example.com',
        address: '客戶地址',
        taxId: '',
      },
      projectName: '測試專案',
      items: [{ description: '設計費', qty: 1, unit: '式', unitPrice: 10000 }],
      discountType: 'none',
      discountValue: 0,
      taxRate: 5,
      deposit: 0,
      notes: '測試備註',
      terms: '測試條款',
      seller: { ...SETTINGS },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  };
}

function get(pathname) {
  return fetch(`${base}${pathname}`, { redirect: 'manual' });
}

function postForm(pathname, pairs = []) {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.append(key, value);
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
    redirect: 'manual',
  });
}

const DEFAULT_FIELDS = {
  clientName: '新客戶',
  clientContact: '陳小姐',
  clientPhone: '0900-222-333',
  clientEmail: 'new@example.com',
  clientAddress: '新地址',
  clientTaxId: '',
  projectName: '新專案',
  issueDate: '2026-02-01',
  validUntil: '2026-02-15',
  status: 'draft',
  discountType: 'none',
  discountValue: '0',
  taxRate: '5',
  deposit: '0',
  notes: '備註',
  terms: '條款',
};

function quoteBody(overrides = {}) {
  const { items, ...rest } = overrides;
  const fields = { ...DEFAULT_FIELDS, ...rest };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) params.append(key, value);
  const rows = items || [{ description: '網站設計', qty: '2', unit: '式', unitPrice: '1000' }];
  for (const row of rows) {
    params.append('itemDescription', row.description ?? '');
    params.append('itemQty', row.qty ?? '');
    params.append('itemUnit', row.unit ?? '');
    params.append('itemUnitPrice', row.unitPrice ?? '');
  }
  return params;
}

function createQuote(overrides = {}) {
  return fetch(`${base}/quotes`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: quoteBody(overrides),
    redirect: 'manual',
  });
}

function updateQuote(id, overrides = {}) {
  return fetch(`${base}/quotes/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: quoteBody(overrides),
    redirect: 'manual',
  });
}

function idFrom(res) {
  const location = res.headers.get('location') || '';
  return location.split('?')[0].split('/').pop();
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quotedesk-'));
  const store = createStore(path.join(dir, 'db.json'), { seed: buildSeed() });
  server = createApp({ store, publicDir: path.join(here, '..', 'public') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dashboard renders the seeded quote and stats', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('報價工坊'));
  assert.ok(html.includes('測試客戶'));
  assert.ok(html.includes('NT$ 10,500'));
});

test('quote list can be searched and filtered', async () => {
  const found = await get('/quotes?q=測試客戶');
  assert.equal(found.status, 200);
  assert.ok((await found.text()).includes('測試專案'));

  const missing = await get('/quotes?q=不存在的客戶');
  assert.ok((await missing.text()).includes('找不到報價單'));

  const filtered = await get('/quotes?status=sent');
  assert.ok((await filtered.text()).includes('測試專案'));
});

test('new quote form renders and can be prefilled from the pricing helper', async () => {
  const res = await get('/quotes/new?price=58080&desc=%E5%B0%88%E6%A1%88%E5%A0%B1%E5%83%B9');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('建立報價單'));
  assert.ok(html.includes('value="58080"'));
  assert.ok(html.includes('專案報價'));
  assert.ok(html.includes('新台幣 陸萬零玖佰捌拾肆元整'));
});

test('creating a quote computes totals on the server', async () => {
  const res = await createQuote({
    deposit: '500',
    items: [
      { description: '網站設計', qty: '2', unit: '式', unitPrice: '1000' },
      { description: '', qty: '', unit: '', unitPrice: '' },
    ],
  });
  assert.equal(res.status, 302);
  const id = idFrom(res);
  assert.ok(id);

  const html = await (await get(`/quotes/${id}`)).text();
  assert.ok(html.includes('新客戶'));
  assert.ok(html.includes('NT$ 2,000'));
  assert.ok(html.includes('NT$ 1,600'));
  assert.ok(html.includes('貳仟壹佰元整'));
  assert.ok(html.includes('網站設計'));
});

test('invalid quote input returns a readable 400', async () => {
  const res = await createQuote({ clientName: '' });
  assert.equal(res.status, 400);
  assert.ok((await res.text()).includes('請填寫客戶名稱'));
});

test('quotes can be edited', async () => {
  const created = await createQuote();
  const id = idFrom(created);

  const updated = await updateQuote(id, { clientName: '改名後的客戶' });
  assert.equal(updated.status, 302);
  assert.equal(updated.headers.get('location'), `/quotes/${id}?msg=${encodeURIComponent('報價單已更新')}&type=ok`);

  const html = await (await get(`/quotes/${id}`)).text();
  assert.ok(html.includes('改名後的客戶'));
});

test('quotes can be duplicated into a new draft', async () => {
  const created = await createQuote();
  const originalId = idFrom(created);

  const duplicate = await postForm(`/quotes/${originalId}/duplicate`);
  assert.equal(duplicate.status, 302);
  const newId = idFrom(duplicate);
  assert.ok(newId);
  assert.notEqual(newId, originalId);

  const html = await (await get(`/quotes/${newId}`)).text();
  assert.ok(html.includes('草稿'));
  assert.notEqual(newId, originalId);
});

test('quote status can be updated', async () => {
  const created = await createQuote();
  const id = idFrom(created);

  const res = await postForm(`/quotes/${id}/status`, [['status', 'accepted']]);
  assert.equal(res.status, 302);

  const html = await (await get(`/quotes/${id}`)).text();
  assert.ok(html.includes('已成交'));
});

test('quotes can be deleted', async () => {
  const created = await createQuote();
  const id = idFrom(created);

  const res = await postForm(`/quotes/${id}/delete`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location').startsWith('/quotes?msg='), true);

  const afterDelete = await get(`/quotes/${id}`);
  assert.equal(afterDelete.status, 404);
});

test('pricing helper returns a suggested price', async () => {
  const res = await postForm('/pricing', [
    ['hours', '40'],
    ['hourlyRate', '1000'],
    ['otherCost', '0'],
    ['overheadRate', '10'],
    ['contingencyRate', '10'],
    ['profitRate', '20'],
    ['taxRate', '5'],
  ]);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('NT$ 58,080'));
  assert.ok(html.includes('NT$ 60,984'));
  assert.ok(html.includes('試算結果'));
});

test('settings are saved and used by new quotes', async () => {
  const res = await postForm('/settings', [
    ['companyName', '更新後工作室'],
    ['companyTaxId', '99999999'],
    ['companyPhone', '0900-999-999'],
    ['companyEmail', 'updated@example.com'],
    ['companyAddress', '更新後地址'],
    ['bankInfo', '更新後銀行'],
    ['defaultTaxRate', '5'],
    ['quotePrefix', 'U'],
    ['defaultTerms', '更新後條款'],
  ]);
  assert.equal(res.status, 302);
  assert.ok((await (await get('/settings')).text()).includes('更新後工作室'));

  const created = await createQuote();
  const html = await (await get(`/quotes/${idFrom(created)}`)).text();
  assert.ok(html.includes('更新後工作室'));
  assert.ok(html.includes('更新後銀行'));
});

test('export returns a JSON backup', async () => {
  const res = await get('/export');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type').includes('application/json'));
  const data = await res.json();
  assert.equal(data.app, 'quotedesk');
  assert.ok(Array.isArray(data.quotes));
  assert.ok(data.quotes.length >= 1);
  assert.equal(data.settings.companyName, '更新後工作室');
});

test('static assets are served with correct content types', async () => {
  const css = await get('/static/styles.css');
  assert.equal(css.status, 200);
  assert.ok(css.headers.get('content-type').includes('text/css'));

  const js = await get('/static/domain.js');
  assert.equal(js.status, 200);
  assert.ok(js.headers.get('content-type').includes('javascript'));
});

test('user content is escaped in the quote document', async () => {
  const created = await createQuote({
    clientName: '<script>alert(1)</script>',
    projectName: '<img src=x onerror=alert(2)>',
  });
  assert.equal(created.status, 302);

  const html = await (await get(`/quotes/${idFrom(created)}`)).text();
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(2)>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('unknown pages return 404', async () => {
  const res = await get('/this-page-does-not-exist');
  assert.equal(res.status, 404);
  assert.ok((await res.text()).includes('找不到頁面'));
});
