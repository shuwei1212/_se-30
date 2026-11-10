import {
  DISCOUNT_LABELS,
  QUOTE_STATUSES,
  STATUS_LABELS,
  computeTotals,
  formatDate,
  formatMoney,
  toChineseAmount,
  todayISO,
} from './domain.js';

const APP_NAME = '報價工坊';
const APP_EN = 'QuoteDesk';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

function money(value) {
  return formatMoney(value);
}

function statusOf(status) {
  return STATUS_LABELS[status] ? status : 'draft';
}

function statusBadge(status) {
  const key = statusOf(status);
  return `<span class="badge badge-${key}">${e(STATUS_LABELS[key])}</span>`;
}

function flashBox(flash) {
  if (!flash || !flash.message) return '';
  const type = flash.type === 'error' ? 'error' : 'ok';
  return `<div class="flash flash-${type}" role="status">${e(flash.message)}</div>`;
}

function navItem(href, label, active) {
  const current = active === href ? ' aria-current="page"' : '';
  return `<a href="${href}"${current}>${label}</a>`;
}

function layout({ title, active = '', body }) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="為自由工作者打造的報價單與定價工作台">
<title>${e(title)} · ${APP_NAME}</title>
<link rel="stylesheet" href="/static/styles.css">
</head>
<body>
<header class="site-header no-print">
  <div class="shell header-inner">
    <a class="brand" href="/">
      <span class="brand-mark">Q</span>
      <span class="brand-text">
        <strong>${APP_NAME}</strong>
        <small>${APP_EN}</small>
      </span>
    </a>
    <nav class="main-nav" aria-label="主要導覽">
      ${navItem('/', '儀表板', active)}
      ${navItem('/quotes', '報價單', active)}
      ${navItem('/pricing', '估價小幫手', active)}
      ${navItem('/settings', '公司設定', active)}
    </nav>
    <a class="btn primary small header-cta" href="/quotes/new">+ 新報價</a>
  </div>
</header>
<main class="shell page">
${body}
</main>
<footer class="site-footer no-print">
  <div class="shell footer-inner">
    <p>${APP_NAME} · 資料保存在自己的電腦，不上傳雲端。</p>
    <p><a href="/export">匯出 JSON 備份</a> · <a href="/pricing">不確定怎麼報價？先試算</a></p>
  </div>
</footer>
<script type="module" src="/static/app.js"></script>
</body>
</html>`;
}

function setupBanner(settings) {
  if (settings && settings.companyName) return '';
  return `<div class="flash flash-warn">
    還沒填公司資訊。列印報價單前，建議先到 <a href="/settings">公司設定</a> 填寫名稱、聯絡方式與匯款資訊。
  </div>`;
}

function quoteTable(quotes) {
  const rows = quotes.map((quote) => {
    const totals = computeTotals(quote);
    return `<tr>
      <td>
        <a class="mono strong" href="/quotes/${e(quote.id)}">${e(quote.number)}</a>
        <div class="muted small">${e(formatDate(quote.issueDate))} 開立</div>
      </td>
      <td>
        <div class="strong">${e(quote.client.name)}</div>
        <div class="muted small">${e(quote.projectName)}</div>
      </td>
      <td class="num">${money(totals.total)}</td>
      <td>${statusBadge(quote.status)}</td>
      <td class="actions">
        <a class="btn tiny" href="/quotes/${e(quote.id)}">檢視</a>
        <a class="btn tiny ghost" href="/quotes/${e(quote.id)}/edit">編輯</a>
      </td>
    </tr>`;
  }).join('');

  return `<div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th>報價編號</th>
          <th>客戶 / 專案</th>
          <th class="num">總計</th>
          <th>狀態</th>
          <th class="actions">操作</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export function dashboardPage({ settings, quotes, stats, flash }) {
  const recent = quotes.slice(0, 5);
  const body = `
    ${setupBanner(settings)}
    ${flashBox(flash)}
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Local-first · 接案者的報價工作台</p>
        <h1>把報價從「憑感覺」變成可重複的專業流程。</h1>
        <p class="lead">
          建立報價單、自動計算稅額與訂金、追蹤成交狀態，
          還能在送出前先算出不虧本的價格。所有資料只留在這台電腦。
        </p>
        <div class="hero-actions">
          <a class="btn primary" href="/quotes/new">建立報價單</a>
          <a class="btn ghost" href="/pricing">試算專案價格</a>
        </div>
      </div>
      <aside class="hero-card">
        <p class="eyebrow">每次接案前</p>
        <ul class="checklist">
          <li>先估工時、管理成本與風險，再決定價格</li>
          <li>報價單加上有效期限，方便後續追蹤</li>
          <li>用成交率回看哪些類型的案件值得接</li>
        </ul>
        <p class="muted small">目前共有 ${stats.count} 份報價單。</p>
      </aside>
    </section>

    <section class="stats-grid" aria-label="報價統計">
      <article class="stat-card">
        <p class="stat-label">報價總額</p>
        <p class="stat-value">${money(stats.quotedTotal)}</p>
        <p class="stat-note">排除已婉拒案件</p>
      </article>
      <article class="stat-card">
        <p class="stat-label">已成交金額</p>
        <p class="stat-value">${money(stats.acceptedTotal)}</p>
        <p class="stat-note">${stats.acceptedCount} 份已成交</p>
      </article>
      <article class="stat-card">
        <p class="stat-label">成交率</p>
        <p class="stat-value">${stats.winRate}%</p>
        <p class="stat-note">已成交 /（已成交＋已婉拒）</p>
      </article>
      <article class="stat-card">
        <p class="stat-label">待追蹤</p>
        <p class="stat-value">${stats.sentCount}</p>
        <p class="stat-note">已送出 ${money(stats.sentTotal)}</p>
      </article>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>最近報價</h2>
          <p class="muted">從最近的案件開始追蹤。</p>
        </div>
        <a class="btn small ghost" href="/quotes">查看全部</a>
      </div>
      ${recent.length ? quoteTable(recent) : `
        <div class="empty-state">
          <h3>還沒有報價單</h3>
          <p>建立第一份報價單，順便到公司設定填好賣方資訊。</p>
          <a class="btn primary" href="/quotes/new">建立第一份報價</a>
        </div>
      `}
    </section>
  `;
  return layout({ title: '儀表板', active: '/', body });
}

export function quotesPage({ quotes, q, status, flash }) {
  const options = [
    `<option value="">全部狀態</option>`,
    ...QUOTE_STATUSES.map((key) => (
      `<option value="${key}"${status === key ? ' selected' : ''}>${e(STATUS_LABELS[key])}</option>`
    )),
  ].join('');

  const body = `
    ${flashBox(flash)}
    <div class="page-head">
      <div>
        <p class="eyebrow">Quotes</p>
        <h1>報價單</h1>
        <p class="muted">共 ${quotes.length} 份符合條件的報價單。</p>
      </div>
      <a class="btn primary" href="/quotes/new">+ 建立報價單</a>
    </div>

    <form class="filter-bar" method="get" action="/quotes">
      <label class="field grow">
        <span>搜尋</span>
        <input type="search" name="q" value="${e(q)}" placeholder="編號、客戶、專案或項目">
      </label>
      <label class="field">
        <span>狀態</span>
        <select name="status">${options}</select>
      </label>
      <div class="filter-actions">
        <button class="btn" type="submit">篩選</button>
        <a class="btn ghost" href="/quotes">清除</a>
      </div>
    </form>

    <section class="panel">
      ${quotes.length ? quoteTable(quotes) : `
        <div class="empty-state">
          <h3>找不到報價單</h3>
          <p>換個關鍵字或清除篩選條件試試看。</p>
          <a class="btn ghost" href="/quotes">清除篩選</a>
        </div>
      `}
    </section>
  `;
  return layout({ title: '報價單', active: '/quotes', body });
}

function inputValue(value) {
  return e(value ?? '');
}

function selected(value, expected) {
  return String(value) === String(expected) ? ' selected' : '';
}

function itemRow(item = {}) {
  const qty = item.qty === undefined ? 1 : item.qty;
  const unit = item.unit === undefined ? '式' : item.unit;
  const unitPrice = item.unitPrice === undefined ? '' : item.unitPrice;
  const amount = computeTotals({ items: [item] }).rows[0].amount;
  return `<tr class="item-row">
    <td><input type="text" name="itemDescription" value="${inputValue(item.description)}" placeholder="例如：網站視覺設計" autocomplete="off"></td>
    <td class="col-qty"><input type="number" name="itemQty" value="${inputValue(qty)}" min="0" step="0.01" inputmode="decimal"></td>
    <td class="col-unit"><input type="text" name="itemUnit" value="${inputValue(unit)}" placeholder="式" autocomplete="off"></td>
    <td class="col-price"><input type="number" name="itemUnitPrice" value="${inputValue(unitPrice)}" min="0" step="0.01" inputmode="decimal"></td>
    <td class="num amount-cell" data-amount>${money(amount)}</td>
    <td class="col-remove"><button type="button" class="btn icon danger" data-remove-item title="刪除這個項目" aria-label="刪除這個項目">×</button></td>
  </tr>`;
}

export function quoteFormPage({ quote, settings, mode, error, flash }) {
  const isNew = mode === 'new';
  const action = isNew ? '/quotes' : `/quotes/${e(quote.id)}`;
  const title = isNew ? '建立報價單' : `編輯 ${quote.number || '報價單'}`;
  const items = Array.isArray(quote.items) && quote.items.length ? quote.items : [{}];
  const totals = computeTotals(quote);

  const statusOptions = (isNew ? ['draft', 'sent'] : QUOTE_STATUSES).map((key) => (
    `<option value="${key}"${selected(quote.status || 'draft', key)}>${e(STATUS_LABELS[key])}</option>`
  )).join('');

  const body = `
    ${flashBox(flash)}
    ${error ? `<div class="flash flash-error" role="alert">${e(error)}</div>` : ''}
    <div class="page-head">
      <div>
        <a class="back" href="${isNew ? '/quotes' : `/quotes/${e(quote.id)}`}">← 返回</a>
        <h1>${e(title)}</h1>
        <p class="muted">填寫客戶與項目，右側會即時計算稅額、訂金與國字大寫金額。</p>
      </div>
    </div>

    <form class="quote-form" method="post" action="${action}" data-quote-form>
      <div class="form-main">
        <section class="card">
          <div class="card-head">
            <h2>客戶與專案</h2>
            <p class="muted">賣方資訊來自 <a href="/settings">公司設定</a>${settings.companyName ? `：${e(settings.companyName)}` : '（尚未設定）'}。</p>
          </div>
          <div class="form-grid">
            <label class="field">
              <span>客戶名稱 *</span>
              <input type="text" name="clientName" value="${inputValue(quote.client && quote.client.name)}" required autocomplete="organization">
            </label>
            <label class="field">
              <span>聯絡人</span>
              <input type="text" name="clientContact" value="${inputValue(quote.client && quote.client.contact)}" autocomplete="name">
            </label>
            <label class="field">
              <span>客戶電話</span>
              <input type="tel" name="clientPhone" value="${inputValue(quote.client && quote.client.phone)}" autocomplete="tel">
            </label>
            <label class="field">
              <span>客戶 Email</span>
              <input type="email" name="clientEmail" value="${inputValue(quote.client && quote.client.email)}" autocomplete="email">
            </label>
            <label class="field span-2">
              <span>客戶地址</span>
              <input type="text" name="clientAddress" value="${inputValue(quote.client && quote.client.address)}" autocomplete="street-address">
            </label>
            <label class="field">
              <span>客戶統一編號</span>
              <input type="text" name="clientTaxId" value="${inputValue(quote.client && quote.client.taxId)}" inputmode="numeric">
            </label>
            <label class="field span-2">
              <span>專案名稱 *</span>
              <input type="text" name="projectName" value="${inputValue(quote.projectName)}" required placeholder="例如：官方網站改版">
            </label>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <h2>報價項目</h2>
            <p class="muted">數量 × 單價 = 小計，金額以新台幣整數計算。</p>
          </div>
          <div class="table-wrap">
            <table class="items-table">
              <thead>
                <tr>
                  <th>項目說明</th>
                  <th class="col-qty">數量</th>
                  <th class="col-unit">單位</th>
                  <th class="col-price">單價</th>
                  <th class="num">金額</th>
                  <th class="col-remove"></th>
                </tr>
              </thead>
              <tbody data-items-body>
                ${items.map(itemRow).join('')}
              </tbody>
            </table>
          </div>
          <template data-item-template>${itemRow({})}</template>
          <div class="items-actions">
            <button type="button" class="btn ghost small" data-add-item>+ 新增項目</button>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <h2>日期、折扣與訂金</h2>
          </div>
          <div class="form-grid">
            <label class="field">
              <span>報價日期</span>
              <input type="date" name="issueDate" value="${inputValue(quote.issueDate)}">
            </label>
            <label class="field">
              <span>有效期限</span>
              <input type="date" name="validUntil" value="${inputValue(quote.validUntil)}">
            </label>
            <label class="field">
              <span>狀態</span>
              <select name="status">${statusOptions}</select>
            </label>
            <label class="field">
              <span>折扣方式</span>
              <select name="discountType" data-discount-type>
                <option value="none"${selected(quote.discountType || 'none', 'none')}>無折扣</option>
                <option value="amount"${selected(quote.discountType, 'amount')}>折抵金額</option>
                <option value="percent"${selected(quote.discountType, 'percent')}>百分比</option>
              </select>
            </label>
            <label class="field">
              <span>折扣數值</span>
              <input type="number" name="discountValue" value="${inputValue(quote.discountValue ?? 0)}" min="0" step="0.01" inputmode="decimal">
            </label>
            <label class="field">
              <span>營業稅率（%）</span>
              <input type="number" name="taxRate" value="${inputValue(quote.taxRate ?? settings.defaultTaxRate)}" min="0" max="100" step="0.1" inputmode="decimal">
            </label>
            <label class="field">
              <span>訂金</span>
              <input type="number" name="deposit" value="${inputValue(quote.deposit ?? 0)}" min="0" step="1" inputmode="decimal">
            </label>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <h2>備註與條款</h2>
          </div>
          <div class="form-grid">
            <label class="field span-2">
              <span>給客戶的備註</span>
              <textarea name="notes" rows="3" placeholder="例如：時程、素材提供方式、假設條件">${inputValue(quote.notes)}</textarea>
            </label>
            <label class="field span-2">
              <span>報價條款</span>
              <textarea name="terms" rows="6">${inputValue(quote.terms)}</textarea>
            </label>
          </div>
        </section>
      </div>

      <aside class="form-side">
        <section class="card totals-card" data-totals>
          <div class="card-head">
            <h2>金額試算</h2>
          </div>
          <dl class="totals-list">
            <div><dt>小計</dt><dd data-subtotal>${money(totals.subtotal)}</dd></div>
            <div><dt>折扣</dt><dd data-discount>${totals.discount ? `-${money(totals.discount)}` : money(0)}</dd></div>
            <div><dt>營業稅 <span data-tax-rate>${totals.taxRate}%</span></dt><dd data-tax>${money(totals.tax)}</dd></div>
            <div class="grand"><dt>總計</dt><dd data-total>${money(totals.total)}</dd></div>
            <div><dt>訂金</dt><dd data-deposit>${money(totals.deposit)}</dd></div>
            <div><dt>尾款</dt><dd data-balance>${money(totals.balance)}</dd></div>
          </dl>
          <p class="chinese-amount" data-chinese>新台幣 ${toChineseAmount(totals.total)}</p>
          <div class="form-actions">
            <button class="btn primary" type="submit">${isNew ? '建立報價單' : '儲存變更'}</button>
            <a class="btn ghost" href="${isNew ? '/quotes' : `/quotes/${e(quote.id)}`}">取消</a>
          </div>
        </section>
        <section class="card tip-card">
          <h3>報價小提醒</h3>
          <ul class="checklist compact">
            <li>折扣是套用在「小計」上，稅金再依折扣後金額計算。</li>
            <li>訂金若超過總計，儲存時會自動以總計為上限。</li>
            <li>不確定價格？先用 <a href="/pricing">估價小幫手</a> 算出不虧本的底價。</li>
          </ul>
        </section>
      </aside>
    </form>
  `;
  return layout({ title, active: '/quotes', body });
}

function partyBlock(title, rows) {
  const content = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<p><span class="muted">${e(label)}</span>${e(value)}</p>`)
    .join('');
  return `<div class="party">
    <h3>${e(title)}</h3>
    ${content || '<p class="muted">尚未填寫</p>'}
  </div>`;
}

export function quoteViewPage({ quote, settings, flash }) {
  const totals = computeTotals(quote);
  const seller = quote.seller && quote.seller.companyName ? quote.seller : settings;
  const expired = quote.validUntil && quote.validUntil < todayISO()
    && (quote.status === 'draft' || quote.status === 'sent');

  const itemRows = totals.rows.map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td>${e(row.description)}</td>
    <td class="num">${e(row.qty)}</td>
    <td>${e(row.unit)}</td>
    <td class="num">${money(row.unitPrice)}</td>
    <td class="num">${money(row.amount)}</td>
  </tr>`).join('');

  const statusButtons = QUOTE_STATUSES.map((key) => {
    const isCurrent = statusOf(quote.status) === key;
    return `<form method="post" action="/quotes/${e(quote.id)}/status">
      <input type="hidden" name="status" value="${key}">
      <button class="btn tiny ${isCurrent ? 'active' : 'ghost'}" type="submit"${isCurrent ? ' disabled' : ''}>
        ${e(STATUS_LABELS[key])}
      </button>
    </form>`;
  }).join('');

  const discountLabel = quote.discountType === 'percent'
    ? `${DISCOUNT_LABELS.percent} ${e(quote.discountValue)}%`
    : DISCOUNT_LABELS[quote.discountType] || DISCOUNT_LABELS.none;

  const body = `
    ${flashBox(flash)}
    <div class="page-head no-print">
      <div>
        <a class="back" href="/quotes">← 回報價列表</a>
        <h1>${e(quote.number)}</h1>
        <p class="muted">${e(quote.client.name)} · ${e(quote.projectName)}</p>
      </div>
      <div class="action-bar">
        <button class="btn primary" type="button" data-print>列印 / 存 PDF</button>
        <a class="btn" href="/quotes/${e(quote.id)}/edit">編輯</a>
        <form method="post" action="/quotes/${e(quote.id)}/duplicate">
          <button class="btn ghost" type="submit">複製</button>
        </form>
        <form method="post" action="/quotes/${e(quote.id)}/delete" data-confirm="確定要刪除這份報價單嗎？此動作無法復原。">
          <button class="btn danger ghost" type="submit">刪除</button>
        </form>
      </div>
    </div>

    <div class="status-bar no-print">
      <span class="muted">更新狀態：</span>
      ${statusButtons}
      ${expired ? '<span class="badge badge-expired">已超過有效期限</span>' : ''}
    </div>

    <article class="quote-doc">
      <header class="doc-head">
        <div class="doc-seller">
          <div class="doc-logo">${e((seller.companyName || 'Q').slice(0, 1))}</div>
          <div>
            <h2>${e(seller.companyName || '你的公司名稱')}</h2>
            ${seller.companyAddress ? `<p>${e(seller.companyAddress)}</p>` : ''}
            ${seller.companyPhone ? `<p>電話：${e(seller.companyPhone)}</p>` : ''}
            ${seller.companyEmail ? `<p>Email：${e(seller.companyEmail)}</p>` : ''}
            ${seller.companyTaxId ? `<p>統一編號：${e(seller.companyTaxId)}</p>` : ''}
          </div>
        </div>
        <div class="doc-title">
          <p class="doc-kicker">QUOTATION</p>
          <h1>報價單</h1>
          <dl class="doc-meta">
            <div><dt>報價編號</dt><dd>${e(quote.number)}</dd></div>
            <div><dt>報價日期</dt><dd>${e(formatDate(quote.issueDate))}</dd></div>
            <div><dt>有效期限</dt><dd>${e(formatDate(quote.validUntil))}</dd></div>
            <div><dt>狀態</dt><dd>${statusBadge(quote.status)}</dd></div>
          </dl>
        </div>
      </header>

      <section class="doc-parties">
        ${partyBlock('賣方', [
          ['名稱', seller.companyName],
          ['統一編號', seller.companyTaxId],
          ['聯絡電話', seller.companyPhone],
          ['Email', seller.companyEmail],
          ['地址', seller.companyAddress],
        ])}
        ${partyBlock('客戶', [
          ['名稱', quote.client.name],
          ['聯絡人', quote.client.contact],
          ['電話', quote.client.phone],
          ['Email', quote.client.email],
          ['地址', quote.client.address],
          ['統一編號', quote.client.taxId],
        ])}
      </section>

      <h2 class="doc-project">${e(quote.projectName)}</h2>

      <table class="doc-items">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>項目說明</th>
            <th class="num">數量</th>
            <th>單位</th>
            <th class="num">單價</th>
            <th class="num">金額</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div class="doc-summary">
        <div class="doc-notes">
          ${quote.notes ? `<h3>備註</h3><p class="pre">${e(quote.notes)}</p>` : ''}
          ${quote.terms ? `<h3>條款</h3><p class="pre">${e(quote.terms)}</p>` : ''}
        </div>
        <dl class="doc-totals">
          <div><dt>小計</dt><dd>${money(totals.subtotal)}</dd></div>
          <div><dt>${e(discountLabel)}</dt><dd>${totals.discount ? `-${money(totals.discount)}` : money(0)}</dd></div>
          <div><dt>營業稅（${totals.taxRate}%）</dt><dd>${money(totals.tax)}</dd></div>
          <div class="grand"><dt>總計</dt><dd>${money(totals.total)}</dd></div>
          <div><dt>訂金</dt><dd>${money(totals.deposit)}</dd></div>
          <div><dt>尾款</dt><dd>${money(totals.balance)}</dd></div>
        </dl>
      </div>

      <p class="doc-chinese">新台幣 ${e(toChineseAmount(totals.total))}</p>

      <footer class="doc-foot">
        ${seller.bankInfo ? `<p><strong>匯款資訊：</strong>${e(seller.bankInfo)}</p>` : ''}
        <p class="muted">本報價單由 ${APP_NAME} 產生。若您同意此報價，請回覆確認並依約定支付訂金。</p>
      </footer>
    </article>
  `;
  return layout({ title: quote.number, active: '/quotes', body });
}

export function pricingPage({ form, result, submitted, settings, flash }) {
  const body = `
    ${flashBox(flash)}
    <div class="page-head">
      <div>
        <p class="eyebrow">Pricing helper</p>
        <h1>估價小幫手</h1>
        <p class="muted">把工時、管理成本、風險與利潤一起算進去，避免接到做白工的案件。</p>
      </div>
    </div>

    <div class="pricing-layout">
      <section class="card">
        <div class="card-head">
          <h2>成本與目標</h2>
          <p class="muted">數字都可以依實際情況調整。</p>
        </div>
        <form method="post" action="/pricing" class="form-grid">
          <label class="field">
            <span>預估工時（小時）</span>
            <input type="number" name="hours" value="${inputValue(form.hours)}" min="0" step="0.5" inputmode="decimal">
          </label>
          <label class="field">
            <span>期望時薪</span>
            <input type="number" name="hourlyRate" value="${inputValue(form.hourlyRate)}" min="0" step="1" inputmode="decimal">
          </label>
          <label class="field">
            <span>其他直接成本</span>
            <input type="number" name="otherCost" value="${inputValue(form.otherCost)}" min="0" step="1" inputmode="decimal">
          </label>
          <label class="field">
            <span>管理負擔（%）</span>
            <input type="number" name="overheadRate" value="${inputValue(form.overheadRate)}" min="0" max="100" step="0.1" inputmode="decimal">
          </label>
          <label class="field">
            <span>風險預備（%）</span>
            <input type="number" name="contingencyRate" value="${inputValue(form.contingencyRate)}" min="0" max="100" step="0.1" inputmode="decimal">
          </label>
          <label class="field">
            <span>目標利潤（%）</span>
            <input type="number" name="profitRate" value="${inputValue(form.profitRate)}" min="0" max="95" step="0.1" inputmode="decimal">
          </label>
          <label class="field">
            <span>營業稅率（%）</span>
            <input type="number" name="taxRate" value="${inputValue(form.taxRate)}" min="0" max="100" step="0.1" inputmode="decimal">
          </label>
          <div class="form-actions span-2">
            <button class="btn primary" type="submit">重新試算</button>
            <a class="btn ghost" href="/pricing">回到預設值</a>
          </div>
        </form>
        <div class="tip-card inline">
          <h3>這些比例怎麼抓？</h3>
          <ul class="checklist compact">
            <li><strong>管理負擔</strong>：行政、溝通、發票、設備折舊等間接成本。</li>
            <li><strong>風險預備</strong>：需求變更、來回修改、延期等不確定性。</li>
            <li><strong>目標利潤</strong>：扣掉成本後希望留下的比例，不是加價率。</li>
          </ul>
        </div>
      </section>

      <aside class="card pricing-result">
        <div class="card-head">
          <h2>${submitted ? '試算結果' : '預設範例'}</h2>
          <p class="muted">${submitted ? '依照你輸入的條件計算。' : '以下是預設值算出的示範，修改左側後按「重新試算」。'}</p>
        </div>
        ${result ? `
          <p class="result-hero">
            <span>建議未稅報價</span>
            <strong>${money(result.beforeTax)}</strong>
          </p>
          <dl class="totals-list">
            <div><dt>人力成本（${result.hours} 小時 × ${money(result.hourlyRate)}）</dt><dd>${money(result.labor)}</dd></div>
            <div><dt>其他直接成本</dt><dd>${money(result.otherCost)}</dd></div>
            <div><dt>管理負擔（${result.overheadRate}%）</dt><dd>${money(result.overhead)}</dd></div>
            <div><dt>風險預備（${result.contingencyRate}%）</dt><dd>${money(result.contingency)}</dd></div>
            <div><dt>總成本</dt><dd>${money(result.cost)}</dd></div>
            <div><dt>目標利潤（${result.profitRate}%）</dt><dd>${money(result.profit)}</dd></div>
            <div class="grand"><dt>含稅總價（${result.taxRate}%）</dt><dd>${money(result.total)}</dd></div>
          </dl>
          <div class="result-facts">
            <div><span>毛利率</span><strong>${result.margin}%</strong></div>
            <div><span>含稅後每小時實收</span><strong>${money(result.effectiveHourly)}</strong></div>
          </div>
          <a class="btn primary full" href="/quotes/new?price=${result.beforeTax}&amp;tax=${result.taxRate}&amp;desc=${encodeURIComponent('專案報價（依工時與成本試算）')}">用這個價格建立報價單</a>
          <p class="muted small">建立後仍可調整項目、折扣與稅率。</p>
        ` : '<p class="muted">請輸入左側條件後試算。</p>'}
      </aside>
    </div>
  `;
  return layout({ title: '估價小幫手', active: '/pricing', body });
}

export function settingsPage({ settings, flash }) {
  const body = `
    ${flashBox(flash)}
    <div class="page-head">
      <div>
        <p class="eyebrow">Settings</p>
        <h1>公司設定</h1>
        <p class="muted">這裡的資訊會出現在新建立的報價單上，既有報價單會保留建立當下的版本。</p>
      </div>
    </div>

    <form class="card settings-form" method="post" action="/settings">
      <section>
        <h2>賣方資訊</h2>
        <div class="form-grid">
          <label class="field">
            <span>公司 / 工作室名稱</span>
            <input type="text" name="companyName" value="${inputValue(settings.companyName)}" autocomplete="organization">
          </label>
          <label class="field">
            <span>統一編號</span>
            <input type="text" name="companyTaxId" value="${inputValue(settings.companyTaxId)}" inputmode="numeric">
          </label>
          <label class="field">
            <span>聯絡電話</span>
            <input type="tel" name="companyPhone" value="${inputValue(settings.companyPhone)}" autocomplete="tel">
          </label>
          <label class="field">
            <span>Email</span>
            <input type="email" name="companyEmail" value="${inputValue(settings.companyEmail)}" autocomplete="email">
          </label>
          <label class="field span-2">
            <span>地址</span>
            <input type="text" name="companyAddress" value="${inputValue(settings.companyAddress)}" autocomplete="street-address">
          </label>
          <label class="field span-2">
            <span>匯款資訊</span>
            <input type="text" name="bankInfo" value="${inputValue(settings.bankInfo)}" placeholder="例如：玉山銀行（808）帳號 0123-456-789012">
          </label>
        </div>
      </section>

      <section>
        <h2>預設值</h2>
        <div class="form-grid">
          <label class="field">
            <span>預設營業稅率（%）</span>
            <input type="number" name="defaultTaxRate" value="${inputValue(settings.defaultTaxRate)}" min="0" max="100" step="0.1" inputmode="decimal">
          </label>
          <label class="field">
            <span>報價單編號前綴</span>
            <input type="text" name="quotePrefix" value="${inputValue(settings.quotePrefix)}" maxlength="8" placeholder="Q">
          </label>
          <label class="field span-2">
            <span>預設報價條款</span>
            <textarea name="defaultTerms" rows="7">${inputValue(settings.defaultTerms)}</textarea>
          </label>
        </div>
      </section>

      <div class="form-actions">
        <button class="btn primary" type="submit">儲存設定</button>
        <a class="btn ghost" href="/export">匯出所有資料</a>
      </div>
    </form>
  `;
  return layout({ title: '公司設定', active: '/settings', body });
}

export function errorPage({ status, message }) {
  const body = `
    <div class="empty-state standalone">
      <p class="eyebrow">Error ${status}</p>
      <h1>${status === 404 ? '找不到頁面' : '發生錯誤'}</h1>
      <p>${e(message)}</p>
      <a class="btn primary" href="/">回首頁</a>
    </div>
  `;
  return layout({ title: `錯誤 ${status}`, body });
}
