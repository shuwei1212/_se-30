import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/db.js';
import { createApp } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let dir;
let store;
let server;
let base;

function cookieOf(res) {
  const raw = res.headers.get('set-cookie') || '';
  const match = raw.match(/sid=[^;]+/);
  return match ? match[0] : null;
}

function get(pathname, cookie) {
  return fetch(`${base}${pathname}`, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  });
}

function post(pathname, cookie, fields) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams(fields || {}),
    redirect: 'manual',
  });
}

async function login(username, password) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
    redirect: 'manual',
  });
  return { res, cookie: cookieOf(res) };
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knu-sis-'));
  store = createStore(path.join(dir, 'db.json'));
  server = createApp({ store, publicDir: path.join(here, '..', 'public') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('anonymous users are redirected to the login page', async () => {
  const res = await get('/');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
});

test('login page renders', async () => {
  const res = await get('/login');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /金門大學校務系統/);
  assert.match(html, /s11501001/);
});

test('wrong password is rejected', async () => {
  const { res, cookie } = await login('s11501001', 'wrong');
  assert.equal(res.status, 401);
  assert.equal(cookie, null);
  assert.match(await res.text(), /帳號或密碼錯誤/);
});

test('student can log in and see the dashboard', async () => {
  const { res, cookie } = await login('s11501001', '1234');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/dashboard');
  assert.match(cookie, /^sid=/);
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);

  const dashboard = await get('/dashboard', cookie);
  assert.equal(dashboard.status, 200);
  const html = await dashboard.text();
  assert.match(html, /董書瑋/);
  assert.match(html, /學生專區/);
  assert.match(html, /4\.15/);
});

test('students cannot access teacher or admin pages', async () => {
  const { cookie } = await login('s11501001', '1234');
  const teacherPage = await get('/teacher/courses', cookie);
  assert.equal(teacherPage.status, 403);
  const adminPage = await get('/admin/courses', cookie);
  assert.equal(adminPage.status, 403);
});

test('student can browse and enroll in a course', async () => {
  const { cookie } = await login('s11501001', '1234');

  const list = await get('/courses', cookie);
  assert.equal(list.status, 200);
  const html = await list.text();
  assert.match(html, /資料結構/);
  assert.match(html, /選課/);

  const enrolled = await post('/courses/CS102/enroll', cookie, {});
  assert.equal(enrolled.status, 302);
  assert.ok(enrolled.headers.get('location').startsWith('/courses?msg='));
  assert.ok(store.getEnrollment('S11501001', 'CS102'));
});

test('duplicate enrollment is rejected', async () => {
  const { cookie } = await login('s11501001', '1234');
  const res = await post('/courses/CS102/enroll', cookie, {});
  assert.equal(res.status, 302);
  assert.match(decodeURIComponent(res.headers.get('location')), /選課失敗/);
  const count = store.getEnrollmentsByStudent('S11501001')
    .filter((enrollment) => enrollment.courseId === 'CS102').length;
  assert.equal(count, 1);
});

test('time conflicts are rejected', async () => {
  const { cookie } = await login('s11501001', '1234');
  const res = await post('/courses/CS210/enroll', cookie, {});
  assert.equal(res.status, 302);
  assert.match(decodeURIComponent(res.headers.get('location')), /衝堂/);
  assert.equal(store.getEnrollment('S11501001', 'CS210'), null);
});

test('student can drop a course', async () => {
  const { cookie } = await login('s11501001', '1234');
  const res = await post('/courses/CS102/drop', cookie, {});
  assert.equal(res.status, 302);
  assert.equal(store.getEnrollment('S11501001', 'CS102'), null);
});

test('timetable shows enrolled courses', async () => {
  const { cookie } = await login('s11501001', '1234');
  const res = await get('/timetable', cookie);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /程式設計/);
  assert.match(html, /微積分/);
  assert.match(html, /網頁程式設計/);
});

test('grades page shows scores and GPA', async () => {
  const { cookie } = await login('s11501001', '1234');
  const res = await get('/grades', cookie);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /4\.15/);
  assert.match(html, />88</);
  assert.match(html, />A</);
});

test('profile page shows student information', async () => {
  const { cookie } = await login('s11501001', '1234');
  const res = await get('/profile', cookie);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /董書瑋/);
  assert.match(html, /資訊工程學系/);
  assert.match(html, /S11501001/);
});

test('teacher can list courses and enter grades', async () => {
  const { res, cookie } = await login('t001', '1234');
  assert.equal(res.status, 302);

  const list = await get('/teacher/courses', cookie);
  assert.equal(list.status, 200);
  assert.match(await list.text(), /程式設計/);

  const course = await get('/teacher/courses/CS101', cookie);
  assert.equal(course.status, 200);
  assert.match(await course.text(), /董書瑋/);

  const saved = await post('/teacher/courses/CS101/grades', cookie, {
    grade_S11501002: '99',
  });
  assert.equal(saved.status, 302);
  assert.equal(store.getEnrollment('S11501002', 'CS101').grade, 99);
});

test('invalid grade is rejected', async () => {
  const { cookie } = await login('t001', '1234');
  const res = await post('/teacher/courses/CS101/grades', cookie, {
    grade_S11501002: '150',
  });
  assert.equal(res.status, 302);
  assert.match(decodeURIComponent(res.headers.get('location')), /成績必須/);
  assert.equal(store.getEnrollment('S11501002', 'CS101').grade, 99);
});

test('teacher cannot manage another teacher course', async () => {
  const { cookie } = await login('t001', '1234');
  const res = await get('/teacher/courses/CS201', cookie);
  assert.equal(res.status, 403);
});

test('admin can create courses and duplicate codes are rejected', async () => {
  const { res, cookie } = await login('admin', 'admin123');
  assert.equal(res.status, 302);

  const page = await get('/admin/courses', cookie);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /課程管理/);

  const created = await post('/admin/courses', cookie, {
    code: 'CS401',
    name: '人工智慧',
    teacherId: 'T001',
    credits: '3',
    day: '3',
    start: '1',
    end: '2',
    room: '理工大樓 E401',
    capacity: '50',
    description: '人工智慧導論',
  });
  assert.equal(created.status, 302);
  assert.ok(store.getCourseById('CS401'));

  const duplicate = await post('/admin/courses', cookie, {
    code: 'CS401',
    name: '人工智慧',
    teacherId: 'T001',
    credits: '3',
    day: '3',
    start: '1',
    end: '2',
    room: '理工大樓 E401',
    capacity: '50',
    description: '',
  });
  assert.match(decodeURIComponent(duplicate.headers.get('location')), /已存在/);
});

test('admin cannot create a course that conflicts with the teacher schedule', async () => {
  const { cookie } = await login('admin', 'admin123');
  const res = await post('/admin/courses', cookie, {
    code: 'CS402',
    name: '衝突課程',
    teacherId: 'T001',
    credits: '3',
    day: '1',
    start: '1',
    end: '2',
    room: 'E402',
    capacity: '30',
    description: '',
  });
  assert.match(decodeURIComponent(res.headers.get('location')), /已有課程/);
  assert.equal(store.getCourseById('CS402'), null);
});

test('admin can view the student list', async () => {
  const { cookie } = await login('admin', 'admin123');
  const res = await get('/admin/students', cookie);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /董書瑋/);
  assert.match(html, /S11501002/);
});

test('teachers can post announcements', async () => {
  const { cookie } = await login('t001', '1234');
  const before = store.getAnnouncements().length;
  const res = await post('/announcements', cookie, {
    title: '課程加簽公告',
    content: '請於本週五前至辦公室辦理加簽。',
  });
  assert.equal(res.status, 302);
  assert.equal(store.getAnnouncements().length, before + 1);

  const page = await get('/announcements', cookie);
  assert.match(await page.text(), /課程加簽公告/);
});

test('static stylesheet is served', async () => {
  const res = await get('/static/styles.css');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/css/);
});

test('logout invalidates the session', async () => {
  const { cookie } = await login('s11501001', '1234');
  const out = await post('/logout', cookie, {});
  assert.equal(out.status, 302);
  assert.equal(out.headers.get('location'), '/login');

  const afterLogout = await get('/dashboard', cookie);
  assert.equal(afterLogout.status, 302);
  assert.equal(afterLogout.headers.get('location'), '/login');
});
