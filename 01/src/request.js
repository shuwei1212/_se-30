import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_USER_AGENT = 'mycurl/1.0.0';

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

function toBuffer(body) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  return Buffer.from(String(body));
}

function decompress(buffer, encoding) {
  if (!buffer.length) return buffer;
  const enc = String(encoding || '').toLowerCase().trim();
  if (!enc || enc === 'identity') return buffer;
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buffer);
    if (enc === 'deflate') {
      try {
        return zlib.inflateSync(buffer);
      } catch {
        return zlib.inflateRawSync(buffer);
      }
    }
    if (enc === 'br') return zlib.brotliDecompressSync(buffer);
  } catch {
    return buffer;
  }
  return buffer;
}

function dropSensitiveHeaders(headers) {
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie') delete headers[key];
  }
}

function singleRequest(url, options) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(Object.assign(new Error(`Invalid URL: ${url}`), { code: 'ERR_INVALID_URL' }));
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    if (!isHttps && parsed.protocol !== 'http:') {
      reject(Object.assign(new Error(`Unsupported protocol: ${parsed.protocol}`), {
        code: 'ERR_UNSUPPORTED_PROTOCOL',
      }));
      return;
    }

    const transport = isHttps ? https : http;
    const method = options.method || 'GET';
    const headers = { ...(options.headers || {}) };
    const body = options.body || null;
    const startedAt = performance.now();

    const req = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
      auth: options.auth,
      rejectUnauthorized: options.rejectUnauthorized !== false,
      agent: options.agent ?? false,
    });

    let settled = false;
    let timer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };

    if (options.timeout != null && options.timeout > 0) {
      timer = setTimeout(() => {
        const err = Object.assign(
          new Error(`Operation timed out after ${Math.round(options.timeout)} ms`),
          { code: 'ETIMEDOUT' },
        );
        finish(reject, err);
        req.destroy(err);
      }, options.timeout);
      if (typeof timer.unref === 'function') timer.unref();
    }

    req.on('error', (err) => finish(reject, err));

    req.on('response', (res) => {
      const firstByteAt = performance.now();
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', (err) => finish(reject, err));
      res.on('end', () => {
        let raw = Buffer.concat(chunks);
        let decompressed = false;
        if (options.decompress !== false && raw.length) {
          const encoding = res.headers['content-encoding'];
          const noBody = res.statusCode === 204 || res.statusCode === 304 || method === 'HEAD';
          if (encoding && !noBody) {
            const out = decompress(raw, encoding);
            if (out !== raw) {
              raw = out;
              decompressed = true;
            }
          }
        }

        const endedAt = performance.now();
        finish(resolve, {
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          httpVersion: res.httpVersion,
          headers: res.headers,
          rawHeaders: res.rawHeaders,
          body: raw,
          method,
          url,
          decompressed,
          contentEncoding: res.headers['content-encoding'] || null,
          remoteAddress: res.socket ? res.socket.remoteAddress : null,
          remotePort: res.socket ? res.socket.remotePort : null,
          timings: {
            startTransfer: firstByteAt - startedAt,
            total: endedAt - startedAt,
          },
        });
      });
    });

    if (body) req.write(body);
    req.end();
  });
}

export async function request(url, options = {}) {
  if (typeof url !== 'string' || !url.trim()) {
    throw new TypeError('request(url): url must be a non-empty string');
  }

  const followRedirect = Boolean(options.followRedirect);
  const maxRedirects = options.maxRedirects == null ? 10 : Number(options.maxRedirects);
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new RangeError('request: maxRedirects must be an integer >= 0');
  }

  let method = String(options.method || 'GET').toUpperCase();
  let body = toBuffer(options.body);
  const headers = { ...(options.headers || {}) };

  if (!hasHeader(headers, 'content-length') && body) {
    headers['content-length'] = String(body.length);
  }
  if (!hasHeader(headers, 'user-agent') && options.userAgent !== null) {
    headers['user-agent'] = options.userAgent === undefined
      ? DEFAULT_USER_AGENT
      : String(options.userAgent);
  }

  const startedAt = performance.now();
  const redirects = [];
  let currentUrl = url;

  for (let attempt = 0; ; attempt += 1) {
    const info = await singleRequest(currentUrl, { ...options, method, headers, body });
    const location = info.headers.location;
    const shouldRedirect = followRedirect && location && REDIRECT_STATUSES.has(info.statusCode);

    if (!shouldRedirect) {
      return {
        ...info,
        url: currentUrl,
        requestUrl: url,
        redirects,
        timings: {
          ...info.timings,
          total: performance.now() - startedAt,
        },
      };
    }

    if (attempt >= maxRedirects) {
      throw Object.assign(new Error(`Maximum (${maxRedirects}) redirects followed`), {
        code: 'ERR_TOO_MANY_REDIRECTS',
        url: currentUrl,
      });
    }

    let nextUrl;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      throw Object.assign(new Error(`Invalid redirect location: ${location}`), {
        code: 'ERR_INVALID_REDIRECT',
      });
    }

    redirects.push({ statusCode: info.statusCode, from: currentUrl, to: nextUrl });

    if (typeof options.onRedirect === 'function') {
      options.onRedirect({
        index: attempt,
        statusCode: info.statusCode,
        from: currentUrl,
        to: nextUrl,
        response: info,
      });
    }

    const from = new URL(currentUrl);
    const to = new URL(nextUrl);
    if (from.origin !== to.origin) dropSensitiveHeaders(headers);

    if (
      info.statusCode === 303
      || ((info.statusCode === 301 || info.statusCode === 302) && method !== 'GET' && method !== 'HEAD')
    ) {
      if (!(info.statusCode === 303 && method === 'HEAD')) {
        method = 'GET';
        body = null;
        const lengthKey = findHeaderKey(headers, 'content-length');
        if (lengthKey) delete headers[lengthKey];
        const typeKey = findHeaderKey(headers, 'content-type');
        if (typeKey) delete headers[typeKey];
      }
    }

    currentUrl = nextUrl;
  }
}

export { DEFAULT_USER_AGENT };
