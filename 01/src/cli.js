#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { request } from './request.js';

const VERSION = '1.0.0';

const LONG_OPTIONS = {
  request: { short: 'X', takesValue: true },
  header: { short: 'H', takesValue: true },
  data: { short: 'd', takesValue: true },
  'data-raw': { takesValue: true },
  'data-binary': { takesValue: true },
  json: { takesValue: true },
  form: { short: 'F', takesValue: true },
  get: { short: 'G' },
  output: { short: 'o', takesValue: true },
  'remote-name': { short: 'O' },
  include: { short: 'i' },
  head: { short: 'I' },
  location: { short: 'L' },
  'max-redirs': { takesValue: true },
  insecure: { short: 'k' },
  silent: { short: 's' },
  'show-error': { short: 'S' },
  verbose: { short: 'v' },
  fail: { short: 'f' },
  compressed: {},
  'max-time': { short: 'm', takesValue: true },
  'connect-timeout': { takesValue: true },
  'user-agent': { short: 'A', takesValue: true },
  referer: { short: 'e', takesValue: true },
  user: { short: 'u', takesValue: true },
  cookie: { short: 'b', takesValue: true },
  'write-out': { short: 'w', takesValue: true },
  url: { takesValue: true },
  help: { short: 'h' },
  version: { short: 'V' },
};

const SHORT_TO_LONG = {};
for (const [name, def] of Object.entries(LONG_OPTIONS)) {
  if (def.short) SHORT_TO_LONG[def.short] = name;
}

const MIME_TYPES = {
  '.txt': 'text/plain',
  '.text': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const HELP = `Usage: mycurl [options] <url> [<url> ...]

A small curl-like HTTP client built with Node.js built-in modules.

Options:
  -X, --request <method>       HTTP method (GET, POST, PUT, DELETE, ...)
  -H, --header <header>        Add a request header, e.g. "Accept: text/html"
  -d, --data <data>            Send data in the body (@file reads a file, @- reads stdin)
      --data-raw <data>        Like -d but does not interpret a leading @
      --data-binary <data>     Like -d but reads files as binary
      --json <data>            Send JSON and set Content-Type/Accept to application/json
  -F, --form <name=value>      Send multipart/form-data (name=@file uploads a file)
  -G, --get                    Put -d data into the URL query string
  -o, --output <file>          Write output to a file ("-" means stdout)
  -O, --remote-name            Write output to a file named after the URL
  -i, --include                Include response headers in the output
  -I, --head                   Send a HEAD request and show only headers
  -L, --location               Follow redirects
      --max-redirs <n>         Maximum redirects to follow (default: 10)
  -k, --insecure               Allow insecure TLS connections
  -s, --silent                 Do not show errors
  -S, --show-error             Show errors even with --silent
  -v, --verbose                Show request/response details
  -f, --fail                   Fail on HTTP status >= 400
      --compressed             Request and decode compressed responses
  -m, --max-time <seconds>     Maximum time for the whole operation
      --connect-timeout <sec>  Timeout used for the request socket
  -A, --user-agent <string>    Set the User-Agent header
  -e, --referer <url>          Set the Referer header
  -u, --user <user:password>   Basic authentication
  -b, --cookie <data>          Send a Cookie header
  -w, --write-out <format>     Print transfer info after the response
  -h, --help                   Show this help
  -V, --version                Show the version

Write-out variables:
  %{http_code} %{status} %{url_effective} %{time_total} %{size_download}
  %{size_header} %{content_type} %{remote_ip} %{method} %{redirect_url}

Examples:
  node src/cli.js https://example.com
  node src/cli.js -L -H "Accept: application/json" https://example.com/api
  node src/cli.js -X POST -H "Content-Type: application/json" \\
    --data '{"name":"wei"}' https://example.com/users
  node src/cli.js -d name=wei -d age=20 https://example.com/form
  node src/cli.js -o page.html https://example.com/
  node src/cli.js -F file=@./README.md https://example.com/upload
  node src/cli.js -w "status=%{http_code} time=%{time_total}s\\n" https://example.com/
`;

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = 2;
  }
}

function parseNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageError(`invalid value for --${name}: ${value}`);
  }
  return n;
}

function parseInteger(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new UsageError(`invalid value for --${name}: ${value}`);
  }
  return n;
}

function applyOption(name, value, cfg) {
  switch (name) {
    case 'request':
      cfg.method = value;
      break;
    case 'header':
      cfg.headers.push(value);
      break;
    case 'data':
      cfg.data.push({ value, mode: 'data' });
      break;
    case 'data-raw':
      cfg.data.push({ value, mode: 'raw' });
      break;
    case 'data-binary':
      cfg.data.push({ value, mode: 'binary' });
      break;
    case 'json':
      cfg.json = value;
      break;
    case 'form':
      cfg.form.push(value);
      break;
    case 'get':
      cfg.get = true;
      break;
    case 'output':
      cfg.outputs.push(value);
      break;
    case 'remote-name':
      cfg.remoteName = true;
      break;
    case 'include':
      cfg.include = true;
      break;
    case 'head':
      cfg.head = true;
      break;
    case 'location':
      cfg.followRedirect = true;
      break;
    case 'max-redirs':
      cfg.maxRedirects = parseInteger(value, name);
      break;
    case 'insecure':
      cfg.insecure = true;
      break;
    case 'silent':
      cfg.silent = true;
      break;
    case 'show-error':
      cfg.showError = true;
      break;
    case 'verbose':
      cfg.verbose = true;
      break;
    case 'fail':
      cfg.fail = true;
      break;
    case 'compressed':
      cfg.compressed = true;
      break;
    case 'max-time':
      cfg.maxTime = parseNumber(value, name);
      break;
    case 'connect-timeout':
      cfg.connectTimeout = parseNumber(value, name);
      break;
    case 'user-agent':
      cfg.userAgent = value;
      break;
    case 'referer':
      cfg.referer = value;
      break;
    case 'user':
      cfg.user = value;
      break;
    case 'cookie':
      cfg.cookies.push(value);
      break;
    case 'write-out':
      cfg.writeOut = value;
      break;
    case 'url':
      cfg.urls.push(value);
      break;
    case 'help':
      cfg.help = true;
      break;
    case 'version':
      cfg.version = true;
      break;
    default:
      throw new UsageError(`unknown option --${name}`);
  }
}

function parseArgs(args) {
  const cfg = {
    method: null,
    headers: [],
    data: [],
    form: [],
    json: null,
    get: false,
    urls: [],
    outputs: [],
    remoteName: false,
    include: false,
    head: false,
    followRedirect: false,
    maxRedirects: 10,
    insecure: false,
    silent: false,
    showError: false,
    verbose: false,
    fail: false,
    compressed: false,
    maxTime: null,
    connectTimeout: null,
    userAgent: undefined,
    referer: null,
    user: null,
    cookies: [],
    writeOut: null,
    help: false,
    version: false,
  };

  let i = 0;
  const takeNext = (label) => {
    if (i + 1 >= args.length) throw new UsageError(`option ${label} requires a value`);
    i += 1;
    return args[i];
  };

  while (i < args.length) {
    const arg = args[i];

    if (arg === '--') {
      i += 1;
      while (i < args.length) {
        cfg.urls.push(args[i]);
        i += 1;
      }
      break;
    }

    if (arg.startsWith('--') && arg.length > 2) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (!Object.prototype.hasOwnProperty.call(LONG_OPTIONS, name)) {
        throw new UsageError(`unknown option --${name}`);
      }
      const def = LONG_OPTIONS[name];
      let value = null;
      if (def.takesValue) {
        value = eq !== -1 ? arg.slice(eq + 1) : takeNext(`--${name}`);
      } else if (eq !== -1) {
        throw new UsageError(`option --${name} does not take a value`);
      }
      applyOption(name, value, cfg);
      i += 1;
      continue;
    }

    if (arg.startsWith('-') && arg !== '-') {
      let pos = 1;
      while (pos < arg.length) {
        const ch = arg[pos];
        const name = SHORT_TO_LONG[ch];
        if (!name) throw new UsageError(`unknown option -${ch}`);
        const def = LONG_OPTIONS[name];
        if (def.takesValue) {
          const value = pos + 1 < arg.length ? arg.slice(pos + 1) : takeNext(`-${ch}`);
          applyOption(name, value, cfg);
          break;
        }
        applyOption(name, null, cfg);
        pos += 1;
      }
      i += 1;
      continue;
    }

    cfg.urls.push(arg);
    i += 1;
  }

  return cfg;
}

function findHeaderKey(headers, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return key;
  }
  return undefined;
}

function hasHeader(headers, name) {
  return findHeaderKey(headers, name) !== undefined;
}

function addHeader(headers, name, value) {
  const key = findHeaderKey(headers, name);
  if (key === undefined) {
    headers[name] = value;
  } else if (Array.isArray(headers[key])) {
    headers[key].push(value);
  } else {
    headers[key] = [headers[key], value];
  }
}

function setHeader(headers, name, value) {
  const key = findHeaderKey(headers, name);
  if (key === undefined) headers[name] = value;
  else headers[key] = value;
}

function parseHeader(raw) {
  const text = String(raw);
  const colon = text.indexOf(':');
  if (colon !== -1) {
    return { name: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim() };
  }
  if (text.endsWith(';')) {
    return { name: text.slice(0, -1).trim(), value: '' };
  }
  return { name: text.trim(), value: '' };
}

function guessMime(filename) {
  return MIME_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

function joinBuffers(buffers, separator) {
  const parts = [];
  buffers.forEach((buf, index) => {
    if (index > 0) parts.push(separator);
    parts.push(buf);
  });
  return Buffer.concat(parts);
}

async function readSource(source, binary) {
  if (source === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  try {
    return fs.readFileSync(source, binary ? undefined : 'utf8');
  } catch (err) {
    const wrapped = new Error(`Failed to read file "${source}": ${err.message}`);
    wrapped.code = err.code;
    wrapped.exitCode = 26;
    throw wrapped;
  }
}

async function resolveData(entries) {
  const parts = [];
  for (const entry of entries) {
    if (entry.mode !== 'raw' && String(entry.value).startsWith('@')) {
      const read = await readSource(String(entry.value).slice(1), entry.mode === 'binary');
      parts.push(Buffer.isBuffer(read) ? read : Buffer.from(read, 'utf8'));
    } else {
      parts.push(Buffer.from(String(entry.value), 'utf8'));
    }
  }
  return joinBuffers(parts, Buffer.from('&'));
}

function buildMultipart(entries) {
  const boundary = `----mycurl${randomUUID().replace(/-/g, '')}`;
  const chunks = [];

  for (const entry of entries) {
    const text = String(entry);
    const eq = text.indexOf('=');
    if (eq === -1) throw new UsageError(`invalid form field "${text}", expected name=value`);
    const name = text.slice(0, eq);
    const value = text.slice(eq + 1);

    let data;
    let filename = null;
    let contentType = null;

    try {
      if (value.startsWith('@')) {
        const file = value.slice(1);
        data = fs.readFileSync(file);
        filename = path.basename(file);
        contentType = guessMime(filename);
      } else if (value.startsWith('<')) {
        data = fs.readFileSync(value.slice(1));
      } else {
        data = Buffer.from(value, 'utf8');
      }
    } catch (err) {
      const wrapped = new Error(`Failed to read form file: ${err.message}`);
      wrapped.code = err.code;
      wrapped.exitCode = 26;
      throw wrapped;
    }

    chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
    if (filename != null) {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n`,
        'utf8',
      ));
      chunks.push(Buffer.from(`Content-Type: ${contentType}\r\n\r\n`, 'utf8'));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`, 'utf8'));
    }
    chunks.push(data);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function appendQuery(url, query) {
  if (!query) return url;
  const hashIndex = url.indexOf('#');
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  let separator = '?';
  if (base.includes('?')) {
    separator = base.endsWith('?') || base.endsWith('&') ? '' : '&';
  }
  return `${base}${separator}${query}${hash}`;
}

async function buildRequestConfig(cfg) {
  if (cfg.form.length && cfg.data.length) {
    throw new UsageError('cannot combine --form with --data');
  }
  if (cfg.form.length && cfg.json != null) {
    throw new UsageError('cannot combine --form with --json');
  }
  if (cfg.data.length && cfg.json != null) {
    throw new UsageError('cannot combine --data with --json');
  }

  let method = cfg.method ? String(cfg.method).toUpperCase() : null;
  if (cfg.head) {
    cfg.include = true;
    if (!method) method = 'HEAD';
  }

  let body = null;
  const extraHeaders = [];

  if (cfg.json != null) {
    const source = String(cfg.json);
    body = source.startsWith('@')
      ? await readSource(source.slice(1), true)
      : Buffer.from(source, 'utf8');
    extraHeaders.push(['Content-Type', 'application/json']);
    extraHeaders.push(['Accept', 'application/json']);
  } else if (cfg.form.length) {
    const built = buildMultipart(cfg.form);
    body = built.body;
    extraHeaders.push(['Content-Type', built.contentType]);
  } else if (cfg.data.length) {
    body = await resolveData(cfg.data);
  }

  if (cfg.get && cfg.data.length && body) {
    const query = body.toString('utf8');
    body = null;
    cfg.urls = cfg.urls.map((url) => appendQuery(url, query));
  }

  if (!method) {
    if (cfg.get) method = 'GET';
    else if (body != null) method = 'POST';
    else method = 'GET';
  }

  const headers = {};
  for (const raw of cfg.headers) {
    const parsed = parseHeader(raw);
    if (parsed.name) addHeader(headers, parsed.name, parsed.value);
  }

  for (const [name, value] of extraHeaders) {
    if (!hasHeader(headers, name)) addHeader(headers, name, value);
  }

  if (cfg.data.length && !cfg.get && !hasHeader(headers, 'content-type')) {
    addHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded');
  }

  if (!hasHeader(headers, 'accept')) addHeader(headers, 'Accept', '*/*');

  if (cfg.referer != null) setHeader(headers, 'Referer', cfg.referer);
  if (cfg.userAgent !== undefined) setHeader(headers, 'User-Agent', cfg.userAgent);

  if (cfg.cookies.length) setHeader(headers, 'Cookie', cfg.cookies.join('; '));

  if (cfg.user != null && !hasHeader(headers, 'authorization')) {
    const index = cfg.user.indexOf(':');
    const username = index === -1 ? cfg.user : cfg.user.slice(0, index);
    const password = index === -1 ? '' : cfg.user.slice(index + 1);
    const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    setHeader(headers, 'Authorization', `Basic ${token}`);
  }

  if (cfg.compressed) {
    if (!hasHeader(headers, 'accept-encoding')) {
      setHeader(headers, 'Accept-Encoding', 'gzip, deflate, br');
    }
    if (!hasHeader(headers, 'user-agent')) {
      setHeader(headers, 'User-Agent', 'mycurl/1.0.0');
    }
  }

  return { method, headers, body };
}

function chooseOutput(cfg, index) {
  if (cfg.outputs.length === 0) return null;
  if (cfg.urls.length === 1) return cfg.outputs[0];
  return cfg.outputs[index] === undefined ? null : cfg.outputs[index];
}

function remoteNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const name = decodeURIComponent(last);
    return name || 'index.html';
  } catch {
    return 'index.html';
  }
}

function renderHeaders(result) {
  const lines = [`HTTP/${result.httpVersion} ${result.statusCode} ${result.statusMessage || ''}`.trimEnd()];
  for (let i = 0; i < result.rawHeaders.length; i += 2) {
    lines.push(`${result.rawHeaders[i]}: ${result.rawHeaders[i + 1]}`);
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'utf8');
}

function formatWriteOut(format, result) {
  return String(format)
    .replace(/\\([nrt])/g, (_, ch) => ({ n: '\n', r: '\r', t: '\t' }[ch]))
    .replace(/%\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
      switch (key) {
        case 'http_code':
        case 'status':
          return String(result.statusCode);
        case 'url_effective':
          return result.url;
        case 'time_total':
          return ((result.timings ? result.timings.total : 0) / 1000).toFixed(6);
        case 'size_download':
          return String(result.body.length);
        case 'size_header':
          return String(renderHeaders(result).length);
        case 'content_type':
          return String(result.headers['content-type'] || '');
        case 'remote_ip':
          return String(result.remoteAddress || '');
        case 'method':
          return String(result.method || '');
        case 'redirect_url':
          return String(result.headers.location || '');
        default:
          return match;
      }
    })
    .replace(/%%/g, '%');
}

function printVerboseRequest(cfg, url, method, headers, body) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  const port = parsed.port || (parsed.protocol === 'https:' ? 443 : 80);
  process.stderr.write(`* Trying ${parsed.hostname}:${port}\n`);
  const target = parsed.pathname + parsed.search || '/';
  process.stderr.write(`> ${method} ${target} HTTP/1.1\n`);

  const shown = { ...headers };
  if (!hasHeader(shown, 'host')) shown.Host = parsed.host;
  if (body && !hasHeader(shown, 'content-length')) shown['Content-Length'] = String(body.length);

  for (const [name, value] of Object.entries(shown)) {
    if (Array.isArray(value)) {
      for (const item of value) process.stderr.write(`> ${name}: ${item}\n`);
    } else {
      process.stderr.write(`> ${name}: ${value}\n`);
    }
  }
  process.stderr.write('>\n');
}

function printVerboseResponse(result) {
  process.stderr.write(`< HTTP/${result.httpVersion} ${result.statusCode} ${result.statusMessage || ''}\n`);
  for (let i = 0; i < result.rawHeaders.length; i += 2) {
    process.stderr.write(`< ${result.rawHeaders[i]}: ${result.rawHeaders[i + 1]}\n`);
  }
  process.stderr.write('<\n');
}

function writeOutput(cfg, result, output) {
  let payload = result.body;
  if (cfg.head) {
    payload = renderHeaders(result);
  } else if (cfg.include) {
    payload = Buffer.concat([renderHeaders(result), result.body]);
  }

  let target = output;
  if (!target && cfg.remoteName) target = remoteNameFromUrl(result.url);
  if (target === '-') target = null;

  if (target) {
    try {
      fs.writeFileSync(target, payload);
    } catch (err) {
      const wrapped = new Error(`Failed to write file "${target}": ${err.message}`);
      wrapped.code = err.code;
      wrapped.exitCode = 23;
      throw wrapped;
    }
    if (cfg.verbose) process.stderr.write(`* Saved to ${target}\n`);
  } else {
    process.stdout.write(payload);
  }

  if (cfg.writeOut) {
    process.stdout.write(formatWriteOut(cfg.writeOut, result));
  }
}

function errorExitCode(err) {
  if (err.exitCode) return err.exitCode;
  switch (err.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 6;
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EPIPE':
      return 7;
    case 'ETIMEDOUT':
      return 28;
    case 'ERR_TOO_MANY_REDIRECTS':
      return 47;
    case 'ERR_INVALID_URL':
    case 'ERR_INVALID_REDIRECT':
    case 'ERR_UNSUPPORTED_PROTOCOL':
      return 3;
    case 'ENOENT':
      return 26;
    case 'ERR_HTTP_STATUS':
      return 22;
    default:
      return 1;
  }
}

async function run() {
  const cfg = parseArgs(process.argv.slice(2));

  if (cfg.help) {
    process.stdout.write(HELP);
    return;
  }
  if (cfg.version) {
    process.stdout.write(`mycurl ${VERSION}\n`);
    return;
  }
  if (cfg.urls.length === 0) {
    throw new UsageError('no URL specified');
  }

  const built = await buildRequestConfig(cfg);
  let exitCode = 0;

  for (let index = 0; index < cfg.urls.length; index += 1) {
    const url = cfg.urls[index];
    const output = chooseOutput(cfg, index);

    try {
      if (cfg.verbose) printVerboseRequest(cfg, url, built.method, built.headers, built.body);

      const result = await request(url, {
        method: built.method,
        headers: built.headers,
        body: built.body,
        followRedirect: cfg.followRedirect,
        maxRedirects: cfg.maxRedirects,
        timeout: (cfg.maxTime != null ? cfg.maxTime : cfg.connectTimeout) != null
          ? (cfg.maxTime != null ? cfg.maxTime : cfg.connectTimeout) * 1000
          : undefined,
        rejectUnauthorized: !cfg.insecure,
        decompress: true,
        onRedirect: cfg.verbose
          ? (info) => {
            process.stderr.write(`* Redirect (${info.statusCode}): ${info.from} -> ${info.to}\n`);
          }
          : undefined,
      });

      if (cfg.verbose) printVerboseResponse(result);

      if (cfg.fail && result.statusCode >= 400) {
        throw Object.assign(
          new Error(`The requested URL returned error: ${result.statusCode}`),
          { code: 'ERR_HTTP_STATUS', exitCode: 22, response: result },
        );
      }

      writeOutput(cfg, result, output);
    } catch (err) {
      const code = errorExitCode(err);
      exitCode = code;
      if (!cfg.silent || cfg.showError) {
        process.stderr.write(`mycurl: (${code}) ${err.message}\n`);
      }
    }
  }

  process.exitCode = exitCode;
}

run().catch((err) => {
  const code = errorExitCode(err);
  if (err instanceof UsageError) {
    process.stderr.write(`mycurl: ${err.message}\n`);
    process.stderr.write("Try 'mycurl --help' for more information.\n");
  } else {
    process.stderr.write(`mycurl: (${code}) ${err.message}\n`);
  }
  process.exitCode = code;
});
