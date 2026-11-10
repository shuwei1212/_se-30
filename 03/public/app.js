import {
  addDaysISO,
  computeTotals,
  formatMoney,
  parseISODate,
  toChineseAmount,
} from './domain.js';

function money(value) {
  return formatMoney(value);
}

function setupQuoteForm(form) {
  const body = form.querySelector('[data-items-body]');
  const template = form.querySelector('[data-item-template]');
  if (!body || !template) return;

  const discountType = form.querySelector('[data-discount-type]');
  const discountValue = form.querySelector('[name="discountValue"]');
  const issueDate = form.querySelector('[name="issueDate"]');
  const validUntil = form.querySelector('[name="validUntil"]');

  function rows() {
    return [...body.querySelectorAll('.item-row')];
  }

  function setText(selector, value) {
    const element = form.querySelector(selector);
    if (element) element.textContent = value;
  }

  function recalc() {
    const input = {
      items: rows().map((row) => ({
        qty: row.querySelector('[name="itemQty"]') ? row.querySelector('[name="itemQty"]').value : '',
        unitPrice: row.querySelector('[name="itemUnitPrice"]') ? row.querySelector('[name="itemUnitPrice"]').value : '',
      })),
      discountType: discountType ? discountType.value : 'none',
      discountValue: discountValue ? discountValue.value : 0,
      taxRate: form.querySelector('[name="taxRate"]') ? form.querySelector('[name="taxRate"]').value : '',
      deposit: form.querySelector('[name="deposit"]') ? form.querySelector('[name="deposit"]').value : '',
    };
    const totals = computeTotals(input);

    rows().forEach((row, index) => {
      const cell = row.querySelector('[data-amount]');
      if (cell) {
        cell.textContent = money(totals.rows[index] ? totals.rows[index].amount : 0);
      }
    });

    setText('[data-subtotal]', money(totals.subtotal));
    setText('[data-discount]', totals.discount ? `-${money(totals.discount)}` : money(0));
    setText('[data-tax-rate]', `${totals.taxRate}%`);
    setText('[data-tax]', money(totals.tax));
    setText('[data-total]', money(totals.total));
    setText('[data-deposit]', money(totals.deposit));
    setText('[data-balance]', money(totals.balance));
    setText('[data-chinese]', `新台幣 ${toChineseAmount(totals.total)}`);
  }

  function syncDiscountFields() {
    if (!discountType || !discountValue) return;
    if (discountType.value === 'percent') {
      discountValue.max = '100';
      discountValue.placeholder = '例如 10';
    } else {
      discountValue.removeAttribute('max');
      discountValue.placeholder = '例如 5000';
    }
  }

  body.addEventListener('input', (event) => {
    if (event.target.matches('input')) recalc();
  });

  body.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-item]');
    if (!remove) return;
    const row = remove.closest('.item-row');
    if (!row) return;
    if (rows().length === 1) {
      row.querySelectorAll('input').forEach((input) => {
        if (input.name === 'itemQty') input.value = '1';
        else if (input.name === 'itemUnit') input.value = '式';
        else input.value = '';
      });
    } else {
      row.remove();
    }
    recalc();
  });

  const add = form.querySelector('[data-add-item]');
  if (add) {
    add.addEventListener('click', () => {
      const fragment = template.content.cloneNode(true);
      const row = fragment.querySelector('.item-row');
      body.appendChild(fragment);
      recalc();
      const first = row ? row.querySelector('input') : null;
      if (first) first.focus();
    });
  }

  if (discountType) {
    discountType.addEventListener('change', () => {
      syncDiscountFields();
      recalc();
    });
  }

  if (issueDate && validUntil) {
    issueDate.addEventListener('change', () => {
      if (!validUntil.value && parseISODate(issueDate.value)) {
        validUntil.value = addDaysISO(issueDate.value, 14);
      }
    });
  }

  syncDiscountFields();
  recalc();
}

function setupPrint() {
  document.querySelectorAll('[data-print]').forEach((button) => {
    button.addEventListener('click', () => window.print());
  });
}

function setupConfirm() {
  document.querySelectorAll('[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm || '確定要執行嗎？')) {
        event.preventDefault();
      }
    });
  });
}

const quoteForm = document.querySelector('[data-quote-form]');
if (quoteForm) setupQuoteForm(quoteForm);
setupPrint();
setupConfirm();
