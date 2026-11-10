import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'src', 'cli.js');

let server;
let base;

function runCli(args, options = {}) {
  return execFileAsync(process.execPath, [cli, ...args], {
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}

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
      } else if (req.url === '/echo-json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          body: body.toString(),
          contentType: req.headers['content-type'] || null,
          method: req.method,
        }));
      } else if (req.url === '/headers') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(req.headers));
      } else if (req.url === '/redirect') {
        res.writeHead(302, { location: '/hello' });
        res.end();
      } else if (req.url === '/gzip') {
        const compressed = zlib.gzipSync(Buffer.from('compressed hello'));
        res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain' });
        res.end(compressed);
      } else if (req.url.startsWith('/query')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ url: req.url }));
      } else if (req.url === '/status/404') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
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

test('--version prints the version', async () => {
  const { stdout } = await runCli(['--version']);
  assert.equal(stdout.trim(), 'mycurl 1.0.0');
});

test('GET prints the response body', async () => {
  const { stdout } = await runCli([`${base}/hello`]);
  assert.equal(stdout, 'hello');
});

test('-d sends a form body as POST', async () => {
  const { stdout } = await runCli(['-d', 'name=wei', '-d', 'age=20', `${base}/echo-json`]);
  const result = JSON.parse(stdout);
  assert.equal(result.method, 'POST');
  assert.equal(result.body, 'name=wei&age=20');
  assert.equal(result.contentType, 'application/x-www-form-urlencoded');
});

test('--json sends JSON headers and body', async () => {
  const { stdout } = await runCli(['--json', '{"name":"wei"}', `${base}/echo-json`]);
  const result = JSON.parse(stdout);
  assert.equal(result.body, '{"name":"wei"}');
  assert.equal(result.contentType, 'application/json');
});

test('-X overrides the method', async () => {
  const { stdout } = await runCli(['-X', 'PUT', '-d', 'a=1', `${base}/echo-json`]);
  const result = JSON.parse(stdout);
  assert.equal(result.method, 'PUT');
  assert.equal(result.body, 'a=1');
});

test('-H adds a header', async () => {
  const { stdout } = await runCli(['-H', 'X-Test: 42', `${base}/headers`]);
  const headers = JSON.parse(stdout);
  assert.equal(headers['x-test'], '42');
});

test('-u sends basic authentication', async () => {
  const { stdout } = await runCli(['-u', 'wei:secret', `${base}/headers`]);
  const headers = JSON.parse(stdout);
  assert.equal(headers.authorization, `Basic ${Buffer.from('wei:secret').toString('base64')}`);
});

test('-i includes response headers', async () => {
  const { stdout } = await runCli(['-i', `${base}/hello`]);
  assert.match(stdout, /^HTTP\/1\.1 200/);
  assert.match(stdout, /content-type: text\/plain/i);
  assert.ok(stdout.endsWith('\r\n\r\nhello'));
});

test('-I prints headers only', async () => {
  const { stdout } = await runCli(['-I', `${base}/hello`]);
  assert.match(stdout, /^HTTP\/1\.1 200/);
  assert.ok(!stdout.includes('\r\n\r\nhello'));
});

test('-L follows redirects', async () => {
  const { stdout } = await runCli(['-L', `${base}/redirect`]);
  assert.equal(stdout, 'hello');
});

test('--compressed requests and decodes gzip', async () => {
  const { stdout } = await runCli(['--compressed', `${base}/gzip`]);
  assert.equal(stdout, 'compressed hello');
});

test('-G puts data into the query string', async () => {
  const { stdout } = await runCli(['-G', '-d', 'name=wei', `${base}/query?a=1`]);
  const result = JSON.parse(stdout);
  assert.equal(result.url, '/query?a=1&name=wei');
});

test('-F sends multipart form data', async () => {
  const { stdout } = await runCli(['-F', 'name=wei', `${base}/echo`]);
  assert.match(stdout, /Content-Disposition: form-data; name="name"/);
  assert.match(stdout, /\r\n\r\nwei\r\n/);
});

test('-o writes the body to a file', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mycurl-output-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'out.txt');

  const { stdout } = await runCli(['-o', file, `${base}/hello`]);
  assert.equal(stdout, '');
  assert.equal(fs.readFileSync(file, 'utf8'), 'hello');
});

test('-O saves with the remote file name', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mycurl-remote-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await runCli(['-O', `${base}/hello`], { cwd: dir });
  assert.equal(fs.readFileSync(path.join(dir, 'hello'), 'utf8'), 'hello');
});

test('-w prints write-out information', async () => {
  const { stdout } = await runCli(['-o', '-', '-w', 'status=%{http_code}\\n', `${base}/hello`]);
  assert.ok(stdout.startsWith('hello'));
  assert.ok(stdout.endsWith('status=200\n'));
});

test('-f fails on HTTP errors with exit code 22', async () => {
  await assert.rejects(
    runCli(['-f', `${base}/status/404`]),
    (err) => {
      assert.equal(err.code, 22);
      assert.equal(err.stdout, '');
      assert.match(err.stderr, /returned error: 404/);
      return true;
    },
  );
});
