import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard, renderErrorPage } from '../views.js';

function fixture(overrides = {}) {
  return {
    web: {
      hostname: 'web-container',
      node: 'v22.0.0',
      uptimeSeconds: 125,
      rssBytes: 48 * 1024 * 1024,
      pid: 1,
      port: 3000,
    },
    db: {
      ok: true,
      database: 'dockerboard',
      user: 'dockerboard',
      version: '16.4',
      size: '8.5 MB',
      uptimeSeconds: 900,
      noteCount: 3,
      viewCount: 42,
      notes: [],
    },
    stats: {
      ok: true,
      data: {
        hostname: 'stats-container',
        python: '3.12.5',
        uptime_seconds: 300,
        requests: 12,
        cpu_count: 8,
        load_1m: 0.12,
        memory_total_mb: 7930,
      },
    },
    notes: [
      {
        id: '7',
        author: 'Wei',
        body: '把 nginx 加到 stack 裡。',
        createdAt: new Date('2026-11-10T08:00:00Z'),
      },
    ],
    gateway: 'nginx',
    clientIp: '203.0.113.7',
    notice: null,
    generatedAt: new Date('2026-11-10T08:30:00Z'),
    ...overrides,
  };
}

test('renderDashboard shows all four services and the architecture', () => {
  const html = renderDashboard(fixture());
  assert.match(html, /nginx/);
  assert.match(html, /Node\.js web/);
  assert.match(html, /Python stats/);
  assert.match(html, /PostgreSQL 16\.4/);
  assert.match(html, /reverse proxy/);
  assert.match(html, /pgdata/);
  assert.match(html, /deploy_notes/);
  assert.match(html, /X-Gateway: nginx/);
});

test('renderDashboard escapes database content', () => {
  const html = renderDashboard(fixture({
    notes: [{
      id: '9',
      author: '<img src=x onerror=alert(1)>',
      body: '</textarea><script>alert(1)</script>',
      createdAt: new Date('2026-11-10T08:00:00Z'),
    }],
  }));
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('renderDashboard renders a warning when nginx is bypassed', () => {
  const html = renderDashboard(fixture({ gateway: 'direct', clientIp: '127.0.0.1' }));
  assert.match(html, /注意/);
  assert.match(html, /未收到 X-Gateway/);
  assert.match(html, /http:\/\/localhost:8080/);
});

test('renderDashboard shows offline states without throwing', () => {
  const html = renderDashboard(fixture({
    db: { ok: false, error: 'connection refused', notes: [], noteCount: 0, viewCount: 0 },
    stats: { ok: false, error: '連線逾時' },
    notes: [],
  }));
  assert.match(html, /離線/);
  assert.match(html, /connection refused/);
  assert.match(html, /連線逾時/);
  assert.match(html, /DB offline/);
});

test('renderDashboard includes known notices and omits unknown ones', () => {
  const html = renderDashboard(fixture({
    notice: { tone: 'ok', text: '筆記已寫入 PostgreSQL，重新整理後仍然存在。' },
  }));
  assert.match(html, /notice-ok/);
  assert.match(html, /筆記已寫入 PostgreSQL/);
});

test('renderErrorPage escapes the message', () => {
  const html = renderErrorPage({ status: 404, message: '<script>x</script>' });
  assert.match(html, /HTTP 404/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
});
