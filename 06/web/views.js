import {
  escapeHtml as e,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatUptime,
} from './lib.js';

function layout({ title, description, body, notice, generatedAt }) {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${e(description)}">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#08111f">
  <title>${e(title)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip-link" href="#main">跳到主要內容</a>
  <header class="topbar">
    <div class="shell topbar-inner">
      <a class="brand" href="/">
        <span class="brand-mark">DB</span>
        <span class="brand-text"><strong>DockerBoard</strong><small>容器觀測站</small></span>
      </a>
      <nav class="topnav" aria-label="主要導覽">
        <a href="/">總覽</a>
        <a href="#notes">部署筆記</a>
        <a href="#api">API</a>
        <a href="#commands">Docker 指令</a>
      </nav>
      <span class="live"><span class="live-dot"></span>live</span>
    </div>
  </header>
  <main id="main" class="shell">
    ${notice ? `<div class="notice notice-${e(notice.tone)}" role="status">${e(notice.text)}</div>` : ''}
    ${body}
  </main>
  <footer class="footer">
    <div class="shell footer-inner">
      <p>DockerBoard · nginx + Node.js + Python + PostgreSQL</p>
      <p>產生時間 ${e(formatDateTime(generatedAt))}</p>
    </div>
  </footer>
</body>
</html>`.replace(/[ \t]+$/gm, '');
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function factRows(rows) {
  return rows.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('');
}

function serviceCard({ id, name, role, tone, rows, note }) {
  const label = tone === 'up' ? '正常' : tone === 'warn' ? '注意' : '離線';
  return `<article class="service-card tone-${tone}" data-service="${e(id)}">
    <header class="service-head">
      <div>
        <p class="eyebrow">${e(role)}</p>
        <h2>${e(name)}</h2>
      </div>
      <span class="status status-${tone}"><span class="status-dot"></span>${label}</span>
    </header>
    <dl class="facts">${factRows(rows)}</dl>
    ${note ? `<p class="service-note">${e(note)}</p>` : ''}
  </article>`;
}

function nginxCard({ gateway, clientIp, generatedAt }) {
  const proxied = gateway === 'nginx';
  return serviceCard({
    id: 'nginx',
    name: 'nginx',
    role: 'gateway / reverse proxy',
    tone: proxied ? 'up' : 'warn',
    rows: [
      ['對外入口', '主機連接埠 → :80'],
      ['請求來源', clientIp],
      ['代理標頭', proxied ? 'X-Gateway: nginx' : '未收到 X-Gateway'],
      ['檢查時間', formatDateTime(generatedAt)],
    ],
    note: proxied ? '' : '目前不是經由 nginx 進入。使用 Docker 時請開啟 nginx 發布的主機連接埠（預設 8080）。',
  });
}

function webCard(web) {
  return serviceCard({
    id: 'web',
    name: 'Node.js web',
    role: 'runtime / SSR',
    tone: 'up',
    rows: [
      ['容器 hostname', web.hostname],
      ['Node.js', web.node],
      ['Process uptime', formatUptime(web.uptimeSeconds)],
      ['記憶體 RSS', formatBytes(web.rssBytes)],
      ['PID / port', `${web.pid} / ${web.port}`],
    ],
  });
}

function statsCard(stats) {
  if (!stats.ok) {
    return serviceCard({
      id: 'stats',
      name: 'Python stats',
      role: 'runtime / 系統資訊',
      tone: 'down',
      rows: [
        ['服務位址', 'stats:8000'],
        ['狀態', '無法連線'],
        ['錯誤', stats.error],
      ],
    });
  }

  const data = stats.data || {};
  return serviceCard({
    id: 'stats',
    name: 'Python stats',
    role: 'runtime / 系統資訊',
    tone: 'up',
    rows: [
      ['容器 hostname', data.hostname],
      ['Python', data.python],
      ['Uptime', formatUptime(data.uptime_seconds)],
      ['Requests', formatNumber(data.requests)],
      ['CPU / load', `${formatNumber(data.cpu_count)} core / ${data.load_1m}`],
      ['記憶體', `${formatNumber(data.memory_total_mb)} MB`],
    ],
  });
}

function dbCard(db) {
  if (!db.ok) {
    return serviceCard({
      id: 'db',
      name: 'PostgreSQL',
      role: 'storage / volume',
      tone: 'down',
      rows: [
        ['服務位址', 'db:5432'],
        ['狀態', '無法連線'],
        ['錯誤', db.error],
      ],
    });
  }

  return serviceCard({
    id: 'db',
    name: 'PostgreSQL',
    role: 'storage / volume',
    tone: 'up',
    rows: [
      ['版本', `PostgreSQL ${db.version}`],
      ['資料庫 / 使用者', `${db.database} / ${db.user}`],
      ['資料庫大小', db.size],
      ['Uptime', formatUptime(db.uptimeSeconds)],
      ['筆記數量', formatNumber(db.noteCount)],
    ],
  });
}

function noticeList(notes, dbOk) {
  if (!notes.length) {
    return `<p class="empty">${dbOk ? '目前沒有筆記，寫下第一筆 Docker 學習紀錄。' : '資料庫離線，暫時讀不到筆記。'}</p>`;
  }

  return `<ul class="note-list">${notes.map((note) => `<li class="note">
    <div class="note-head">
      <div><strong>${e(note.author)}</strong><span class="note-id">#${e(note.id)}</span></div>
      <time datetime="${e(isoDate(note.createdAt))}">${e(formatDateTime(note.createdAt))}</time>
    </div>
    <p class="note-body">${e(note.body)}</p>
    <form method="post" action="/notes/${encodeURIComponent(note.id)}/delete">
      <button class="link-button danger" type="submit" aria-label="刪除筆記 ${e(note.id)}">刪除</button>
    </form>
  </li>`).join('')}</ul>`;
}

function noteForm(dbOk) {
  return `<form class="note-form" method="post" action="/notes">
    <div class="note-fields">
      <label class="field">
        <span>署名</span>
        <input type="text" name="author" maxlength="40" placeholder="匿名" autocomplete="nickname"${dbOk ? '' : ' disabled'}>
      </label>
      <label class="field grow">
        <span>筆記內容</span>
        <textarea name="body" maxlength="280" rows="3" required placeholder="例如：今天學會用 nginx 把 /api/stats 轉到 Python 容器。"${dbOk ? '' : ' disabled'}></textarea>
      </label>
    </div>
    <div class="note-form-foot">
      <p>限制 280 字，寫入 PostgreSQL 的 <code>deploy_notes</code> 資料表。</p>
      <button class="button" type="submit"${dbOk ? '' : ' disabled'}>寫入資料庫</button>
    </div>
  </form>`;
}

export function renderDashboard(data) {
  const db = data.db;
  const notes = data.notes || [];
  const viewCount = db.ok ? formatNumber(db.viewCount) : '—';
  const noteCount = db.ok ? formatNumber(db.noteCount) : '—';

  const body = `
    <section class="hero">
      <p class="eyebrow">Docker microservices demo</p>
      <h1>一個由容器組成的<br><span>系統觀測站</span></h1>
      <p class="lede">Browser 只認識 nginx；Node.js 負責頁面與 PostgreSQL；Python 回報容器狀態。每個服務都有自己的 Dockerfile，並用 healthcheck 串起啟動順序。</p>
      <div class="hero-actions">
        <a class="button" href="#notes">寫一筆部署筆記</a>
        <a class="button ghost" href="/api/system">查看 JSON API</a>
      </div>
    </section>

    <section class="arch" role="img" aria-label="Browser 連到 nginx，nginx 轉發到 Node web 與 Python stats，只有 Node web 連到 PostgreSQL">
      <div class="arch-node">
        <span class="arch-kicker">client</span>
        <strong>Browser</strong>
        <small>:8080</small>
      </div>
      <span class="arch-arrow" aria-hidden="true">→</span>
      <div class="arch-node accent">
        <span class="arch-kicker">gateway</span>
        <strong>nginx</strong>
        <small>reverse proxy</small>
      </div>
      <span class="arch-arrow" aria-hidden="true">→</span>
      <div class="arch-branch">
        <div class="arch-node">
          <span class="arch-kicker">runtime</span>
          <strong>Node.js web</strong>
          <small>:3000 · SSR + API</small>
        </div>
        <div class="arch-node">
          <span class="arch-kicker">runtime</span>
          <strong>Python stats</strong>
          <small>:8000 · JSON</small>
        </div>
      </div>
      <span class="arch-arrow" aria-hidden="true">→</span>
      <div class="arch-node">
        <span class="arch-kicker">storage</span>
        <strong>PostgreSQL</strong>
        <small>:5432 · pgdata</small>
      </div>
    </section>

    <section class="status-grid" aria-label="服務狀態">
      ${nginxCard(data)}
      ${webCard(data.web)}
      ${statsCard(data.stats)}
      ${dbCard(db)}
    </section>

    <section class="panel split persistence">
      <div>
        <p class="eyebrow">PostgreSQL volume</p>
        <h2>重啟容器，資料還在</h2>
        <p>每次載入這個頁面，<code>dashboard_views</code> 就會加一。執行 <code>docker compose down</code> 再 <code>up</code>，數字不會歸零；只有加上 <code>-v</code> 才會刪除 named volume。</p>
        <p class="muted">目前請求來自 ${e(data.clientIp)}，代理狀態：${e(data.gateway === 'nginx' ? '經過 nginx' : '直接連線')}。</p>
      </div>
      <div class="metrics" role="group" aria-label="資料庫指標">
        <div><strong>${viewCount}</strong><span>頁面瀏覽次數</span></div>
        <div><strong>${noteCount}</strong><span>部署筆記</span></div>
        <div><strong>pgdata</strong><span>named volume</span></div>
      </div>
    </section>

    <section class="panel" id="notes">
      <div class="panel-head">
        <div>
          <p class="eyebrow">deploy_notes</p>
          <h2>部署筆記</h2>
        </div>
        <span class="chip">${db.ok ? `${noteCount} rows` : 'DB offline'}</span>
      </div>
      ${noteForm(db.ok)}
      ${db.ok ? '' : `<p class="service-note">PostgreSQL 目前離線，表單已暫停。請執行 <code>docker compose logs db</code> 檢查。</p>`}
      ${noticeList(notes, db.ok)}
    </section>

    <section class="panel split" id="api">
      <div>
        <p class="eyebrow">HTTP API</p>
        <h2>用 curl 看系統</h2>
        <ul class="api-list">
          <li><a href="/api/system">/api/system</a><span>聚合 Node、Python、PostgreSQL 狀態</span></li>
          <li><a href="/api/health">/api/health</a><span>web + DB 健康檢查，Docker healthcheck 使用</span></li>
          <li><a href="/api/stats">/api/stats</a><span>經 nginx 轉到 Python stats</span></li>
          <li><a href="/nginx-health">/nginx-health</a><span>nginx 自己的健康檢查</span></li>
        </ul>
      </div>
      <pre class="code"><code>curl http://localhost:8080/api/system
curl http://localhost:8080/api/stats
curl http://localhost:8080/nginx-health
docker compose logs -f web</code></pre>
    </section>

    <section class="panel" id="commands">
      <div class="panel-head">
        <div>
          <p class="eyebrow">cheatsheet</p>
          <h2>常用 Docker 指令</h2>
        </div>
        <span class="chip">Compose v2</span>
      </div>
      <div class="command-grid">
        <div><code>docker compose up --build -d</code><span>建置並啟動整套系統</span></div>
        <div><code>docker compose ps</code><span>看容器與健康狀態</span></div>
        <div><code>docker compose logs -f nginx</code><span>追蹤反向代理日誌</span></div>
        <div><code>docker compose exec db psql -U dockerboard -d dockerboard</code><span>進入 PostgreSQL</span></div>
        <div><code>docker compose down</code><span>停止容器，保留 volume</span></div>
        <div><code>docker compose down -v</code><span>停止並刪除資料</span></div>
      </div>
    </section>

    <details class="panel flow">
      <summary>這個請求經過了哪些容器？</summary>
      <ol class="flow-list">
        <li>Browser 連到 nginx 的 <code>8080</code>。</li>
        <li>nginx 依路徑轉發：<code>/</code> 到 <code>web:3000</code>，<code>/api/stats</code> 到 <code>stats:8000</code>。</li>
        <li>web 用 pg Pool 連到 <code>db:5432</code>，讀寫 <code>deploy_notes</code> 與 <code>counters</code>。</li>
        <li>web 再從 <code>stats:8000</code> 取得 Python 容器資訊，組成這個 SSR 頁面。</li>
      </ol>
    </details>
  `;

  return layout({
    title: 'DockerBoard · 容器觀測站',
    description: 'nginx、Node.js、Python 與 PostgreSQL 組成的 Docker 微服務示範。',
    body,
    notice: data.notice,
    generatedAt: data.generatedAt,
  });
}

export function renderErrorPage({ status, message, generatedAt = new Date() }) {
  return layout({
    title: `${status} · DockerBoard`,
    description: message,
    generatedAt,
    notice: null,
    body: `<section class="panel error-panel">
      <p class="eyebrow">HTTP ${e(status)}</p>
      <h1>${e(message)}</h1>
      <p>這個路徑不存在，或服務暫時無法處理請求。</p>
      <p><a class="button" href="/">回到總覽</a></p>
    </section>`,
  });
}
