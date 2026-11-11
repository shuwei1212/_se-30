import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  charLength,
  cleanAuthor,
  cleanBody,
  firstForwardedIp,
  noticeFor,
} from './lib.js';
import { renderDashboard, renderErrorPage } from './views.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const STATS_URL = String(process.env.STATS_URL || 'http://stats:8000').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://dockerboard:dockerboard_dev@db:5432/dockerboard';
const CSP = "default-src 'none'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; script-src 'none'";
const startedAt = new Date();

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 3000,
});

pool.on('error', (error) => {
  console.error(`[web] PostgreSQL pool error: ${error.message}`);
});

const assets = new Map([
  ['/styles.css', {
    type: 'text/css; charset=utf-8',
    body: fs.readFileSync(path.join(__dirname, 'public', 'styles.css')),
  }],
  ['/favicon.svg', {
    type: 'image/svg+xml',
    body: fs.readFileSync(path.join(__dirname, 'public', 'favicon.svg')),
  }],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function commonHeaders() {
  return {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
}

function send(res, status, contentType, body, extraHeaders = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, {
    ...commonHeaders(),
    'Content-Type': contentType,
    'Content-Length': payload.length,
    ...extraHeaders,
  });
  res.end(payload);
}

function sendHtml(res, status, html) {
  send(res, status, 'text/html; charset=utf-8', html);
}

function sendJson(res, status, value) {
  send(res, status, 'application/json; charset=utf-8', `${JSON.stringify(value, null, 2)}\n`);
}

function redirect(res, location) {
  res.writeHead(303, {
    ...commonHeaders(),
    Location: location,
    'Content-Length': '0',
  });
  res.end();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, '表單內容過大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readForm(req) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    throw new HttpError(415, '僅接受 application/x-www-form-urlencoded');
  }
  const body = await readBody(req);
  return new URLSearchParams(body);
}

function webInfo() {
  return {
    hostname: os.hostname(),
    node: process.version,
    uptimeSeconds: process.uptime(),
    rssBytes: process.memoryUsage().rss,
    pid: process.pid,
    port: PORT,
    startedAt,
  };
}

async function loadStats() {
  try {
    const response = await fetch(`${STATS_URL}/stats`, {
      headers: { 'x-internal-caller': 'web' },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { ok: true, data: await response.json() };
  } catch (error) {
    return {
      ok: false,
      error: error.name === 'TimeoutError' ? '連線逾時' : error.message,
    };
  }
}

async function loadDatabase({ incrementViews }) {
  try {
    const [infoResult, countResult, notesResult] = await Promise.all([
      pool.query(`
        SELECT current_database() AS database,
               current_user AS "user",
               current_setting('server_version') AS version,
               pg_size_pretty(pg_database_size(current_database())) AS size,
               pg_postmaster_start_time() AS started_at
      `),
      pool.query('SELECT count(*)::int AS count FROM deploy_notes'),
      pool.query(`
        SELECT id::text AS id, author, body, created_at AS "createdAt"
        FROM deploy_notes
        ORDER BY id DESC
        LIMIT 50
      `),
    ]);

    let viewCount = 0;
    if (incrementViews) {
      const viewResult = await pool.query(`
        INSERT INTO counters (name, value)
        VALUES ('dashboard_views', 1)
        ON CONFLICT (name) DO UPDATE
          SET value = counters.value + 1,
              updated_at = now()
        RETURNING value
      `);
      viewCount = Number(viewResult.rows[0].value);
    } else {
      const viewResult = await pool.query("SELECT value FROM counters WHERE name = 'dashboard_views'");
      viewCount = Number(viewResult.rows[0]?.value || 0);
    }

    const info = infoResult.rows[0];
    return {
      ok: true,
      database: info.database,
      user: info.user,
      version: info.version,
      size: info.size,
      startedAt: info.started_at,
      uptimeSeconds: (Date.now() - new Date(info.started_at).getTime()) / 1000,
      noteCount: countResult.rows[0].count,
      viewCount,
      notes: notesResult.rows,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      notes: [],
      noteCount: 0,
      viewCount: 0,
    };
  }
}

async function gatherDashboard(req, { incrementViews = false, noticeCode = null } = {}) {
  const gateway = String(req.headers['x-gateway'] || 'direct');
  const clientIp = firstForwardedIp(
    req.headers['x-forwarded-for'],
    req.socket.remoteAddress || '未知',
  );

  const [db, stats] = await Promise.all([
    loadDatabase({ incrementViews }),
    loadStats(),
  ]);

  return {
    web: webInfo(),
    db,
    stats,
    notes: db.notes,
    gateway,
    clientIp,
    notice: noticeFor(noticeCode),
    generatedAt: new Date(),
  };
}

async function handleNoteCreate(req, res) {
  const form = await readForm(req);
  const rawBody = String(form.get('body') ?? '').trim();
  if (!rawBody || charLength(rawBody) > 280) {
    redirect(res, '/?notice=note-invalid#notes');
    return;
  }

  const author = cleanAuthor(form.get('author'));
  const body = cleanBody(rawBody);
  try {
    await pool.query('INSERT INTO deploy_notes (author, body) VALUES ($1, $2)', [author, body]);
  } catch (error) {
    console.error(`[web] insert note failed: ${error.message}`);
    throw new HttpError(503, '無法寫入 PostgreSQL，請稍後再試');
  }
  redirect(res, '/?notice=note-added#notes');
}

async function handleNoteDelete(req, res, id) {
  try {
    const result = await pool.query('DELETE FROM deploy_notes WHERE id = $1', [id]);
    redirect(res, result.rowCount ? '/?notice=note-deleted#notes' : '/?notice=note-missing#notes');
  } catch (error) {
    console.error(`[web] delete note failed: ${error.message}`);
    throw new HttpError(503, '無法刪除 PostgreSQL 筆記，請稍後再試');
  }
}

async function handleRequest(req, res) {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', 'http://localhost');

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, '網址格式不正確');
  }

  if (method === 'GET' && assets.has(pathname)) {
    const asset = assets.get(pathname);
    send(res, 200, asset.type, asset.body, { 'Cache-Control': 'public, max-age=300' });
    return;
  }

  if (method === 'GET' && pathname === '/') {
    const data = await gatherDashboard(req, {
      incrementViews: true,
      noticeCode: url.searchParams.get('notice'),
    });
    sendHtml(res, 200, renderDashboard(data));
    return;
  }

  if (method === 'GET' && pathname === '/api/health') {
    const started = Date.now();
    try {
      await pool.query('SELECT 1');
      sendJson(res, 200, {
        ok: true,
        service: 'web',
        database: 'up',
        latency_ms: Date.now() - started,
        hostname: os.hostname(),
        node: process.version,
        uptime_seconds: Math.round(process.uptime()),
        time: new Date().toISOString(),
      });
    } catch (error) {
      sendJson(res, 503, {
        ok: false,
        service: 'web',
        database: 'down',
        error: error.message,
        hostname: os.hostname(),
        time: new Date().toISOString(),
      });
    }
    return;
  }

  if (method === 'GET' && pathname === '/api/system') {
    const data = await gatherDashboard(req, { incrementViews: false });
    sendJson(res, 200, data);
    return;
  }

  if (method === 'GET' && pathname === '/api/notes') {
    try {
      const result = await pool.query(`
        SELECT id::text AS id, author, body, created_at AS "createdAt"
        FROM deploy_notes
        ORDER BY id DESC
        LIMIT 50
      `);
      sendJson(res, 200, { ok: true, notes: result.rows });
    } catch (error) {
      sendJson(res, 503, { ok: false, error: error.message });
    }
    return;
  }

  if (method === 'POST' && pathname === '/notes') {
    await handleNoteCreate(req, res);
    return;
  }

  const deleteMatch = pathname.match(/^\/notes\/(\d+)\/delete$/);
  if (method === 'POST' && deleteMatch) {
    await handleNoteDelete(req, res, deleteMatch[1]);
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { ok: false, error: 'not_found', path: pathname });
    return;
  }

  sendHtml(res, 404, renderErrorPage({ status: 404, message: '找不到頁面' }));
}

async function waitForDatabase(attempts = 30) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      const result = await pool.query(`
        SELECT to_regclass('public.deploy_notes') AS notes,
               to_regclass('public.counters') AS counters
      `);
      if (!result.rows[0].notes || !result.rows[0].counters) {
        throw new Error('資料表尚未建立，init.sql 可能尚未執行');
      }
      console.log('[web] PostgreSQL schema ready');
      return;
    } catch (error) {
      lastError = error;
      console.error(`[web] 等待 PostgreSQL (${attempt}/${attempts}): ${error.message}`);
      await sleep(1000);
    }
  }
  throw lastError;
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.url !== '/api/health') {
      console.log(`[web] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started}ms)`);
    }
  });

  handleRequest(req, res).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : '伺服器發生錯誤';
    console.error(`[web] ${req.method} ${req.url}: ${error.stack || error.message}`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (req.url?.startsWith('/api/')) {
      sendJson(res, status, { ok: false, error: message });
      return;
    }
    sendHtml(res, status, renderErrorPage({ status, message }));
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[web] received ${signal}, shutting down`);
  server.close(async () => {
    try {
      await pool.end();
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main() {
  await waitForDatabase();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[web] listening on http://0.0.0.0:${PORT}`);
    console.log(`[web] stats upstream: ${STATS_URL}`);
    console.log(`[web] started at ${startedAt.toISOString()}`);
  });
}

main().catch((error) => {
  console.error(`[web] 啟動失敗: ${error.message}`);
  process.exit(1);
});
