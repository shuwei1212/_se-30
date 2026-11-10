import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { computeGpa, gradeInfo } from './domain.js';
import {
  adminCoursesPage,
  adminDashboard,
  adminStudentsPage,
  announcementsPage,
  coursesPage,
  errorPage,
  gradesPage,
  loginPage,
  profilePage,
  studentDashboard,
  teacherCoursePage,
  teacherCoursesPage,
  teacherDashboard,
  timetablePage,
} from './views.js';

const SESSION_TTL = 8 * 60 * 60 * 1000;
const ALL_ROLES = ['student', 'teacher', 'admin'];
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function sendHtml(res, status, html) {
  const buffer = Buffer.from(html, 'utf8');
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buffer.length,
  });
  res.end(buffer);
}

function redirect(res, location, status = 302, extraHeaders = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    Location: location,
    'Content-Length': 0,
    ...extraHeaders,
  });
  res.end();
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const raw = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(raw);
    } catch {
      cookies[key] = raw;
    }
  }
  return cookies;
}

function matchPath(pattern, pathname) {
  const expected = pattern.split('/').filter(Boolean);
  const actual = pathname.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i].startsWith(':')) {
      try {
        params[expected[i].slice(1)] = decodeURIComponent(actual[i]);
      } catch {
        return null;
      }
    } else if (expected[i] !== actual[i]) {
      return null;
    }
  }
  return params;
}

function readForm(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        const error = new Error('請求內容過大');
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
  });
}

function buildFlash(query) {
  const message = query.get('msg');
  if (!message) return null;
  return {
    type: query.get('type') === 'error' ? 'error' : 'ok',
    message,
  };
}

function encodeFlash(res, location, ok, message) {
  const type = ok ? 'ok' : 'error';
  redirect(res, `${location}?msg=${encodeURIComponent(message)}&type=${type}`);
}

function buildSearchText(course, teacher) {
  return [
    course.code,
    course.name,
    course.description,
    teacher ? teacher.name : '',
  ].join(' ').toLowerCase();
}

export function createApp({ store, publicDir }) {
  if (!store) throw new TypeError('createApp: store is required');
  const staticRoot = publicDir || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const sessions = new Map();

  function teacherOf(course) {
    return store.getUserById(course.teacherId);
  }

  function courseEntries(studentId) {
    const courseMap = new Map(store.getCourses().map((course) => [course.id, course]));
    const enrollments = store.getEnrollmentsByStudent(studentId);
    const entries = enrollments.map((enrollment) => {
      const course = courseMap.get(enrollment.courseId);
      if (!course) return null;
      return {
        enrollment,
        course,
        teacher: teacherOf(course),
        info: gradeInfo(enrollment.grade),
      };
    }).filter(Boolean);
    return { courseMap, enrollments, entries };
  }

  function renderError(res, user, status, message) {
    if (res.headersSent) return;
    sendHtml(res, status, errorPage({ user, status, message }));
  }

  function serveStatic(res, file) {
    const resolvedRoot = path.resolve(staticRoot);
    const resolved = path.resolve(staticRoot, file);
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not found');
      return;
    }
    fs.readFile(resolved, (err, buffer) => {
      if (err) {
        res.writeHead(404, SECURITY_HEADERS);
        res.end('Not found');
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const type = ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': type,
        'Content-Length': buffer.length,
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(buffer);
    });
  }

  function loginGet({ user, res }) {
    if (user) return redirect(res, '/dashboard');
    return sendHtml(res, 200, loginPage());
  }

  function loginPost({ req, res, body }) {
    const username = body.get('username') || '';
    const password = body.get('password') || '';
    if (!username.trim() || !password) {
      return sendHtml(res, 400, loginPage({ error: '請輸入帳號與密碼' }));
    }

    const account = store.getUserByUsername(username);
    if (!account || account.password !== password) {
      return sendHtml(res, 401, loginPage({ error: '帳號或密碼錯誤' }));
    }

    const sid = randomUUID();
    sessions.set(sid, { userId: account.id, createdAt: Date.now() });
    const cookie = `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`;
    return redirect(res, '/dashboard', 302, { 'Set-Cookie': cookie });
  }

  function logoutPost({ res, sid }) {
    if (sid) sessions.delete(sid);
    return redirect(res, '/login', 302, {
      'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    });
  }

  function dashboard({ user, res, flash }) {
    if (user.role === 'student') {
      const { enrollments, entries } = courseEntries(user.id);
      const courseMap = new Map(entries.map((entry) => [entry.course.id, entry.course]));
      const summary = computeGpa(enrollments, courseMap);
      const pending = entries.filter((entry) => entry.enrollment.grade == null).length;
      const announcements = store.getAnnouncements().slice(0, 3);
      return sendHtml(res, 200, studentDashboard({
        user, entries, summary, pending, announcements, flash,
      }));
    }

    if (user.role === 'teacher') {
      const rows = store.getTeacherCourses(user.id).map((course) => {
        const list = store.getEnrollmentsByCourse(course.id);
        return {
          course,
          count: list.length,
          graded: list.filter((enrollment) => enrollment.grade != null).length,
        };
      });
      const students = new Set();
      for (const row of rows) {
        for (const enrollment of store.getEnrollmentsByCourse(row.course.id)) {
          students.add(enrollment.studentId);
        }
      }
      return sendHtml(res, 200, teacherDashboard({
        user, rows, studentCount: students.size, flash,
      }));
    }

    const stats = store.getStats();
    const recentCourses = store.getCourses().slice(0, 5).map((course) => ({
      course,
      teacher: teacherOf(course),
      count: store.getEnrollmentsByCourse(course.id).length,
    }));
    const announcements = store.getAnnouncements().slice(0, 3);
    return sendHtml(res, 200, adminDashboard({
      user, stats, recentCourses, announcements, flash,
    }));
  }

  function coursesGet({ user, res, query, flash }) {
    const q = (query.get('q') || '').trim();
    const needle = q.toLowerCase();
    const enrolledIds = new Set(
      store.getEnrollmentsByStudent(user.id).map((enrollment) => enrollment.courseId),
    );
    const rows = store.getCourses()
      .map((course) => ({ course, teacher: teacherOf(course) }))
      .filter(({ course, teacher }) => !needle || buildSearchText(course, teacher).includes(needle))
      .map(({ course, teacher }) => ({
        course,
        teacher,
        count: store.getEnrollmentsByCourse(course.id).length,
        enrolled: enrolledIds.has(course.id),
      }));
    return sendHtml(res, 200, coursesPage({ user, rows, q, flash }));
  }

  function enrollPost({ user, res, params }) {
    const result = store.enroll(user.id, params.id);
    return encodeFlash(res, '/courses', result.ok, result.ok ? '選課成功' : `選課失敗：${result.error}`);
  }

  function dropPost({ user, res, params }) {
    const result = store.drop(user.id, params.id);
    return encodeFlash(res, '/courses', result.ok, result.ok ? '退選成功' : `退選失敗：${result.error}`);
  }

  function timetableGet({ user, res, flash }) {
    const { entries } = courseEntries(user.id);
    return sendHtml(res, 200, timetablePage({ user, entries, flash }));
  }

  function gradesGet({ user, res, flash }) {
    const { courseMap, enrollments } = courseEntries(user.id);
    const rows = enrollments.map((enrollment) => {
      const course = courseMap.get(enrollment.courseId);
      if (!course) return null;
      return {
        course,
        score: enrollment.grade,
        info: gradeInfo(enrollment.grade),
      };
    }).filter(Boolean);
    const summary = computeGpa(enrollments, courseMap);
    return sendHtml(res, 200, gradesPage({ user, rows, summary, flash }));
  }

  function profileGet({ user, res, flash }) {
    const { courseMap, enrollments, entries } = courseEntries(user.id);
    const summary = computeGpa(enrollments, courseMap);
    const rows = entries.map((entry) => ({
      course: entry.course,
      score: entry.enrollment.grade,
    }));
    return sendHtml(res, 200, profilePage({ user, rows, summary, flash }));
  }

  function teacherCoursesGet({ user, res, flash }) {
    const rows = store.getTeacherCourses(user.id).map((course) => {
      const list = store.getEnrollmentsByCourse(course.id);
      return {
        course,
        count: list.length,
        graded: list.filter((enrollment) => enrollment.grade != null).length,
      };
    });
    return sendHtml(res, 200, teacherCoursesPage({ user, rows, flash }));
  }

  function teacherCourseGet({ user, res, params, flash }) {
    const course = store.getCourseById(params.id);
    if (!course) return renderError(res, user, 404, '找不到這門課程');
    if (course.teacherId !== user.id) return renderError(res, user, 403, '您沒有權限管理這門課程');

    const roster = store.getEnrollmentsByCourse(course.id).map((enrollment) => ({
      enrollment,
      student: store.getUserById(enrollment.studentId),
    })).filter((row) => row.student)
      .sort((a, b) => a.student.id.localeCompare(b.student.id));

    return sendHtml(res, 200, teacherCoursePage({
      user, course, teacher: teacherOf(course), roster, flash,
    }));
  }

  function teacherGradesPost({ user, res, params, body }) {
    const course = store.getCourseById(params.id);
    if (!course) return renderError(res, user, 404, '找不到這門課程');
    if (course.teacherId !== user.id) return renderError(res, user, 403, '您沒有權限管理這門課程');

    const roster = store.getEnrollmentsByCourse(course.id);
    const errors = [];
    for (const enrollment of roster) {
      const key = `grade_${enrollment.studentId}`;
      if (!body.has(key)) continue;
      const result = store.setGrade(enrollment.studentId, course.id, body.get(key));
      if (!result.ok) errors.push(`${enrollment.studentId}：${result.error}`);
    }

    return encodeFlash(
      res,
      `/teacher/courses/${course.id}`,
      errors.length === 0,
      errors.length ? errors[0] : '成績已儲存',
    );
  }

  function adminCoursesGet({ user, res, flash }) {
    const rows = store.getCourses().map((course) => ({
      course,
      teacher: teacherOf(course),
      count: store.getEnrollmentsByCourse(course.id).length,
    }));
    return sendHtml(res, 200, adminCoursesPage({
      user, rows, teachers: store.getTeachers(), flash,
    }));
  }

  function adminCourseCreatePost({ user, res, body }) {
    const result = store.createCourse({
      code: body.get('code'),
      name: body.get('name'),
      teacherId: body.get('teacherId'),
      credits: body.get('credits'),
      day: body.get('day'),
      start: body.get('start'),
      end: body.get('end'),
      room: body.get('room'),
      capacity: body.get('capacity'),
      description: body.get('description'),
    });
    return encodeFlash(
      res,
      '/admin/courses',
      result.ok,
      result.ok ? `課程 ${result.course.code} 已新增` : `新增失敗：${result.error}`,
    );
  }

  function adminCourseDeletePost({ user, res, params }) {
    const result = store.deleteCourse(params.id);
    return encodeFlash(
      res,
      '/admin/courses',
      result.ok,
      result.ok ? `課程 ${result.course.code} 已刪除` : `刪除失敗：${result.error}`,
    );
  }

  function adminStudentsGet({ user, res, flash }) {
    const students = store.getStudents().map((student) => {
      const list = store.getEnrollmentsByStudent(student.id);
      return {
        student,
        count: list.length,
        graded: list.filter((enrollment) => enrollment.grade != null).length,
      };
    });
    return sendHtml(res, 200, adminStudentsPage({ user, students, flash }));
  }

  function announcementsGet({ user, res, flash }) {
    return sendHtml(res, 200, announcementsPage({
      user, announcements: store.getAnnouncements(), flash,
    }));
  }

  function announcementCreatePost({ user, res, body }) {
    const result = store.addAnnouncement({
      title: body.get('title'),
      content: body.get('content'),
      author: user.name,
    });
    return encodeFlash(
      res,
      '/announcements',
      result.ok,
      result.ok ? '公告已發布' : `發布失敗：${result.error}`,
    );
  }

  const routes = [
    { method: 'GET', path: '/login', public: true, handler: loginGet },
    { method: 'POST', path: '/login', public: true, handler: loginPost },
    { method: 'GET', path: '/static/:file', public: true, handler: ({ res, params }) => serveStatic(res, params.file) },
    { method: 'GET', path: '/favicon.ico', public: true, handler: ({ res }) => { res.writeHead(204, SECURITY_HEADERS); res.end(); } },
    { method: 'GET', path: '/', roles: ALL_ROLES, handler: ({ res }) => redirect(res, '/dashboard') },
    { method: 'POST', path: '/logout', roles: ALL_ROLES, handler: logoutPost },
    { method: 'GET', path: '/dashboard', roles: ALL_ROLES, handler: dashboard },
    { method: 'GET', path: '/courses', roles: ['student'], handler: coursesGet },
    { method: 'POST', path: '/courses/:id/enroll', roles: ['student'], handler: enrollPost },
    { method: 'POST', path: '/courses/:id/drop', roles: ['student'], handler: dropPost },
    { method: 'GET', path: '/timetable', roles: ['student'], handler: timetableGet },
    { method: 'GET', path: '/grades', roles: ['student'], handler: gradesGet },
    { method: 'GET', path: '/profile', roles: ['student'], handler: profileGet },
    { method: 'GET', path: '/teacher/courses', roles: ['teacher'], handler: teacherCoursesGet },
    { method: 'GET', path: '/teacher/courses/:id', roles: ['teacher'], handler: teacherCourseGet },
    { method: 'POST', path: '/teacher/courses/:id/grades', roles: ['teacher'], handler: teacherGradesPost },
    { method: 'GET', path: '/admin/courses', roles: ['admin'], handler: adminCoursesGet },
    { method: 'POST', path: '/admin/courses', roles: ['admin'], handler: adminCourseCreatePost },
    { method: 'POST', path: '/admin/courses/:id/delete', roles: ['admin'], handler: adminCourseDeletePost },
    { method: 'GET', path: '/admin/students', roles: ['admin'], handler: adminStudentsGet },
    { method: 'GET', path: '/announcements', roles: ALL_ROLES, handler: announcementsGet },
    { method: 'POST', path: '/announcements', roles: ['teacher', 'admin'], handler: announcementCreatePost },
  ];

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';
    const pathname = url.pathname;

    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies.sid;
    let session = sid ? sessions.get(sid) : undefined;
    if (session && Date.now() - session.createdAt > SESSION_TTL) {
      sessions.delete(sid);
      session = undefined;
    }
    let user = session ? store.getUserById(session.userId) : null;
    if (!user && session) {
      sessions.delete(sid);
      session = undefined;
    }

    let route = null;
    let params = {};
    for (const candidate of routes) {
      if (candidate.method !== method) continue;
      const matched = matchPath(candidate.path, pathname);
      if (matched) {
        route = candidate;
        params = matched;
        break;
      }
    }

    if (!route) {
      if (!user && !pathname.startsWith('/static/')) return redirect(res, '/login');
      return renderError(res, user, 404, '找不到頁面');
    }

    if (!route.public && !user) return redirect(res, '/login');
    if (route.roles && (!user || !route.roles.includes(user.role))) {
      return renderError(res, user, 403, '您沒有權限使用此功能');
    }

    let body = new URLSearchParams();
    if (method === 'POST') {
      try {
        body = await readForm(req);
      } catch (err) {
        return renderError(res, user, err.statusCode || 400, err.message);
      }
    }

    const ctx = {
      req,
      res,
      url,
      method,
      params,
      query: url.searchParams,
      user,
      body,
      sid,
      flash: buildFlash(url.searchParams),
    };

    try {
      await route.handler(ctx);
    } catch (err) {
      console.error(err);
      renderError(res, user, 500, '伺服器發生錯誤');
    }
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, SECURITY_HEADERS);
        res.end('Internal Server Error');
      }
    });
  });
}
