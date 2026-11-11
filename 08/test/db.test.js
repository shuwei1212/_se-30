import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/db.js';
import { addDaysISO, todayISO } from '../src/domain.js';

let dir;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quotedesk-db-'));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function emptyStore(name = 'db') {
  return createStore(path.join(dir, `${name}.json`), {
    seed: {
      settings: {
        companyName: 'DB 測試工作室',
        defaultTaxRate: 5,
        quotePrefix: 'D',
      },
      quotes: [],
    },
  });
}

function quoteInput(overrides = {}) {
  const issueDate = overrides.issueDate || todayISO();
  return {
    client: { name: 'DB 客戶' },
    projectName: 'DB 專案',
    issueDate,
    validUntil: addDaysISO(issueDate, 14),
    followUpDate: overrides.followUpDate || addDaysISO(issueDate, 7),
    followUpNote: '追蹤備註',
    status: 'draft',
    items: [{ description: '設計', qty: 1, unit: '式', unitPrice: 10000, unitCost: 4000 }],
    discountType: 'none',
    discountValue: 0,
    taxRate: 5,
    deposit: 0,
    notes: '',
    internalNotes: '內部備註',
    terms: '',
    ...overrides,
  };
}

test('store seeds a new file with the richer demo data', () => {
  const file = path.join(dir, 'seed.json');
  const store = createStore(file);
  assert.equal(fs.existsSync(file), true);
  assert.equal(store.getQuotes().length, 3);
  assert.equal(store.getSettings().lowMarginThreshold, 20);
  assert.ok(store.getQuotes().some((quote) => quote.items.some((item) => item.unitCost > 0)));
  assert.ok(store.getQuotes().some((quote) => quote.payments.length > 0));
});

test('store computes cost, margin, payments and follow-up stats', () => {
  const store = emptyStore('stats');
  const created = store.createQuote(quoteInput({
    status: 'sent',
    followUpDate: addDaysISO(todayISO(), -1),
  }));
  assert.equal(created.ok, true);
  const id = created.quote.id;

  const accepted = store.setQuoteStatus(id, 'accepted');
  assert.equal(accepted.ok, true);
  const paid = store.addPayment(id, {
    amount: 1000,
    date: todayISO(),
    method: '匯款',
  });
  assert.equal(paid.ok, true);

  const quote = store.getQuoteById(id);
  assert.equal(quote.followUpNote, '追蹤備註');
  assert.equal(quote.internalNotes, '內部備註');
  assert.equal(quote.items[0].unitCost, 4000);

  const stats = store.getStats();
  assert.equal(stats.acceptedTotal, 10500);
  assert.equal(stats.acceptedProfit, 6000);
  assert.equal(stats.acceptedMargin, 60);
  assert.equal(stats.paidTotal, 1000);
  assert.equal(stats.receivable, 9500);
  assert.equal(stats.followUpCount, 0);
  assert.equal(stats.overdueCount, 0);
  assert.equal(stats.lowMarginCount, 0);
});

test('store filters overdue and attention follow-ups', () => {
  const store = emptyStore('follow-up');
  const overdue = store.createQuote(quoteInput({
    projectName: '逾期專案',
    status: 'sent',
    followUpDate: addDaysISO(todayISO(), -2),
  }));
  const later = store.createQuote(quoteInput({
    projectName: '較晚專案',
    status: 'sent',
    followUpDate: addDaysISO(todayISO(), 20),
  }));
  assert.equal(overdue.ok, true);
  assert.equal(later.ok, true);

  assert.deepEqual(store.getQuotes({ followUp: 'overdue' }).map((q) => q.projectName), ['逾期專案']);
  assert.deepEqual(store.getQuotes({ followUp: 'attention' }).map((q) => q.projectName), ['逾期專案']);
  const stats = store.getStats();
  assert.equal(stats.followUpCount, 1);
  assert.equal(stats.overdueCount, 1);
});

test('store snapshots edits and restores a revision', () => {
  const store = emptyStore('revisions');
  const created = store.createQuote(quoteInput());
  const id = created.quote.id;

  const updated = store.updateQuote(id, quoteInput({ projectName: '更新後專案' }));
  assert.equal(updated.ok, true);
  assert.equal(updated.quote.revisions.length, 1);
  assert.equal(updated.quote.revisions[0].reason, '更新前版本');

  const revisionId = updated.quote.revisions[0].id;
  const restored = store.restoreRevision(id, revisionId);
  assert.equal(restored.ok, true);
  assert.equal(restored.quote.projectName, 'DB 專案');
  assert.equal(restored.quote.revisions.length, 2);
  assert.equal(restored.quote.revisions[0].reason, '還原前版本');
});

test('store rejects overpayment and supports removing a payment', () => {
  const store = emptyStore('payments');
  const created = store.createQuote(quoteInput());
  const id = created.quote.id;

  const tooMuch = store.addPayment(id, { amount: 20000, date: todayISO() });
  assert.equal(tooMuch.ok, false);
  assert.ok(tooMuch.error.includes('超過未收款'));

  const paid = store.addPayment(id, { amount: 500, date: todayISO() });
  assert.equal(paid.ok, true);
  const quote = store.getQuoteById(id);
  assert.equal(quote.payments.length, 1);

  const removed = store.removePayment(id, paid.payment.id);
  assert.equal(removed.ok, true);
  assert.equal(store.getQuoteById(id).payments.length, 0);
});

test('store exports JSON and CSV', () => {
  const store = emptyStore('exports');
  const created = store.createQuote(quoteInput({
    client: { name: '匯出,客戶' },
    projectName: '匯出專案',
  }));
  assert.equal(created.ok, true);

  const data = store.exportData();
  assert.equal(data.app, 'quotedesk-studio');
  assert.equal(data.version, 2);
  assert.equal(data.quotes.length, 1);

  const csv = store.exportCsv();
  assert.ok(csv.includes('報價編號'));
  assert.ok(csv.includes('毛利率'));
  assert.ok(csv.includes('"匯出,客戶"'));
  assert.ok(csv.includes('匯出專案'));
});
