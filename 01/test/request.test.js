import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { request } from '../src/request.js';

let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);

      if (req.url === '/hello') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('hello');
      } else if (req.url === '/echo') {
        res.writeHead(200, {
          'content-type': req.headers['content-type'] || 'application/octet-stream',
          'x-method': req.method,
        });
        res.end(body);
      } else if (req.url === '/headers') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(req.headers));
      } else if (req.url === '/redirect') {
        res.writeHead(302, { location: '/hello' });
        res.end();
      } else if (req.url === '/redirect-post') {
        res.writeHead(303, { location: '/echo' });
        res.end();
      } else if (req.url === '/redirect-307') {
        res.writeHead(307, { location: '/echo' });
        res.end();
      } else if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' });
        res.end();
      } else if (req.url === '/gzip') {
        const compressed = zlib.gzipSync(Buffer.from('compressed hello'));
        res.writeHead(200, {
          'content-encoding': 'gzip',
          'content-type': 'text/plain',
        });
        res.end(compressed);
      } else if (req.url === '/status/404') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
      } else if (req.url === '/slow') {
        setTimeout(() => {
          if (!res.destroyed) {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('slow');
          }
        }, 150);
      } else {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('unknown');
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET returns status, body and headers', async () => {
  const res = await request(`${base}/hello`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.method, 'GET');
  assert.equal(res.body.toString(), 'hello');
  assert.equal(res.headers['content-type'], 'text/plain');
  assert.equal(res.requestUrl, `${base}/hello`);
});

test('POST sends a body', async () => {
  const res = await request(`${base}/echo`, {
    method: 'POST',
    body: 'abc',
    headers: { 'Content-Type': 'text/plain' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.toString(), 'abc');
  assert.equal(res.headers['x-method'], 'POST');
});

test('custom headers are sent', async () => {
  const res = await request(`${base}/headers`, {
    headers: { 'X-Test': '42', Accept: 'application/json' },
  });
  const received = JSON.parse(res.body.toString());
  assert.equal(received['x-test'], '42');
  assert.equal(received.accept, 'application/json');
  assert.match(received['user-agent'], /^mycurl\//);
});

test('redirect is not followed by default', async () => {
  const res = await request(`${base}/redirect`);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/hello');
  assert.equal(res.redirects.length, 0);
});

test('redirect is followed with followRedirect', async () => {
  const res = await request(`${base}/redirect`, { followRedirect: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.toString(), 'hello');
  assert.equal(res.redirects.length, 1);
  assert.equal(res.url, `${base}/hello`);
});

test('303 redirect changes POST to GET', async () => {
  const res = await request(`${base}/redirect-post`, {
    method: 'POST',
    body: 'ignored',
    followRedirect: true,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-method'], 'GET');
  assert.equal(res.body.toString(), '');
});

test('307 redirect keeps method and body', async () => {
  const res = await request(`${base}/redirect-307`, {
    method: 'POST',
    body: 'kept',
    followRedirect: true,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-method'], 'POST');
  assert.equal(res.body.toString(), 'kept');
});

test('redirect limit is enforced', async () => {
  await assert.rejects(
    request(`${base}/loop`, { followRedirect: true, maxRedirects: 2 }),
    (err) => err.code === 'ERR_TOO_MANY_REDIRECTS',
  );
});

test('gzip responses are decompressed', async () => {
  const res = await request(`${base}/gzip`);
  assert.equal(res.body.toString(), 'compressed hello');
  assert.equal(res.decompressed, true);
});

test('non-2xx responses are returned normally', async () => {
  const res = await request(`${base}/status/404`);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.toString(), 'not found');
});

test('HEAD requests have an empty body', async () => {
  const res = await request(`${base}/hello`, { method: 'HEAD' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.length, 0);
});

test('timeout rejects with ETIMEDOUT', async () => {
  await assert.rejects(
    request(`${base}/slow`, { timeout: 40 }),
    (err) => err.code === 'ETIMEDOUT',
  );
});
