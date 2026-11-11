import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  TaskStore,
  TaskValidationError,
} from './store.js';
import {
  parseTaskFilter,
  parseTaskPatch,
} from './validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DEFAULT_PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const DEFAULT_DATA_FILE = path.join(ROOT_DIR, 'data', 'tasks.json');
const SERVICE_NAME = 'tasklane';
const SERVICE_VERSION = '1.0.0';
const MAX_BODY_BYTES = 64 * 1024;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const STATIC_FILES = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/favicon.svg', { file: 'favicon.svg', type: 'image/svg+xml' }],
]);

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function baseHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': CSP,
  };
}

function send(res, status, contentType, body, extraHeaders = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, {
    ...baseHeaders(),
    'Content-Type': contentType,
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

function sendJson(res, status, payload) {
  send(res, status, 'application/json; charset=utf-8', `${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(res, status, text) {
  send(res, status, 'text/plain; charset=utf-8', `${text}\n`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();

    if (contentType !== 'application/json') {
      req.resume();
      reject(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必須是 application/json。'));
      return;
    }

    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', `請求內容不可超過 ${MAX_BODY_BYTES} bytes。`));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') {
        reject(new HttpError(400, 'INVALID_JSON', '請求內容不能是空的。'));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', '請求內容不是有效的 JSON。'));
      }
    });

    req.on('error', (error) => {
      if (!tooLarge) reject(error);
    });
  });
}

async function serveStatic(res, pathname, publicDir) {
  const entry = STATIC_FILES.get(pathname);
  if (!entry) return false;

  let body;
  try {
    body = await readFile(path.join(publicDir, entry.file));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new HttpError(404, 'NOT_FOUND', '找不到頁面。');
    }
    throw error;
  }

  send(res, 200, entry.type, body, {
    'Cache-Control': pathname === '/' || pathname === '/index.html'
      ? 'no-store'
      : 'public, max-age=300',
  });
  return true;
}

function validationError(error) {
  return new HttpError(400, 'VALIDATION_ERROR', error.message, { fields: error.fields });
}

async function handleRequest(req, res, { store, publicDir, startedAt }) {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  if (method === 'GET' && await serveStatic(res, pathname, publicDir)) {
    return;
  }

  if (method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      tasks: store.stats(),
      time: new Date().toISOString(),
    });
    return;
  }

  if (method === 'GET' && pathname === '/api/tasks') {
    const filter = parseTaskFilter(url.searchParams.get('status'));
    if (!filter) {
      throw new HttpError(400, 'INVALID_FILTER', 'status 必須是 all、active 或 done。');
    }
    sendJson(res, 200, { ok: true, tasks: store.list(filter) });
    return;
  }

  if (method === 'GET' && pathname === '/api/stats') {
    sendJson(res, 200, { ok: true, stats: store.stats() });
    return;
  }

  if (method === 'POST' && pathname === '/api/tasks') {
    const body = await readJson(req);
    try {
      const task = await store.create(body);
      sendJson(res, 201, { ok: true, task });
    } catch (error) {
      if (error instanceof TaskValidationError) throw validationError(error);
      throw error;
    }
    return;
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && (method === 'PATCH' || method === 'DELETE')) {
    let id;
    try {
      id = decodeURIComponent(taskMatch[1]);
    } catch {
      throw new HttpError(400, 'INVALID_ID', '任務 id 格式不正確。');
    }

    if (method === 'PATCH') {
      const body = await readJson(req);
      const parsed = parseTaskPatch(body);
      if (!parsed.ok) {
        throw new HttpError(400, 'VALIDATION_ERROR', '輸入資料不正確。', { fields: parsed.errors });
      }

      const task = await store.setDone(id, parsed.value.done);
      if (!task) throw new HttpError(404, 'TASK_NOT_FOUND', '找不到這個任務。');
      sendJson(res, 200, { ok: true, task });
      return;
    }

    const deleted = await store.remove(id);
    if (!deleted) throw new HttpError(404, 'TASK_NOT_FOUND', '找不到這個任務。');
    res.writeHead(204, baseHeaders());
    res.end();
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, {
      ok: false,
      error: { code: 'NOT_FOUND', message: '找不到 API。' },
    });
    return;
  }

  if (method !== 'GET') {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  sendText(res, 404, '找不到頁面。');
}

export function createApp({ store, publicDir = DEFAULT_PUBLIC_DIR, startedAt = new Date() } = {}) {
  if (!store) throw new Error('createApp 需要 TaskStore。');
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);

  return async function app(req, res) {
    try {
      await handleRequest(req, res, { store, publicDir, startedAt: start });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof HttpError ? error.message : '伺服器發生錯誤。';

      if (status >= 500) console.error(error);
      if (res.headersSent) {
        res.destroy();
        return;
      }

      const payload = {
        ok: false,
        error: {
          code,
          message,
          ...(error instanceof HttpError && error.details?.fields
            ? { fields: error.details.fields }
            : {}),
        },
      };

      if ((req.url || '').startsWith('/api/')) {
        sendJson(res, status, payload);
        return;
      }
      sendText(res, status, message);
    }
  };
}

export async function startServer({
  port = process.env.PORT || 3000,
  host = process.env.HOST || '127.0.0.1',
  dataFile = process.env.DATA_FILE || DEFAULT_DATA_FILE,
  publicDir = DEFAULT_PUBLIC_DIR,
} = {}) {
  const store = new TaskStore({ filePath: path.resolve(dataFile) });
  await store.init();

  const server = http.createServer(createApp({ store, publicDir }));

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(Number(port), host);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : Number(port);
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;

  return {
    server,
    store,
    port: actualPort,
    host,
    url: `http://${displayHost}:${actualPort}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

const isMain = Boolean(process.argv[1])
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  startServer()
    .then((app) => {
      console.log(`[tasklane] listening on ${app.url}`);
      console.log(`[tasklane] data file: ${app.store.filePath}`);

      let stopping = false;
      const shutdown = async (signal) => {
        if (stopping) return;
        stopping = true;
        console.log(`[tasklane] received ${signal}, shutting down`);
        try {
          await app.close();
          process.exit(0);
        } catch (error) {
          console.error(error);
          process.exit(1);
        }
      };

      process.once('SIGINT', () => shutdown('SIGINT'));
      process.once('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((error) => {
      console.error(`[tasklane] 啟動失敗：${error.message}`);
      process.exit(1);
    });
}
