import fs from 'node:fs';
import path from 'node:path';
import { createSeed } from './seed.js';
import { coursesOverlap } from './domain.js';

function normalize(value) {
  const base = { users: [], courses: [], enrollments: [], announcements: [] };
  const data = { ...base, ...(value || {}) };
  for (const key of Object.keys(base)) {
    if (!Array.isArray(data[key])) data[key] = [];
  }
  return data;
}

export function createStore(file, options = {}) {
  const seed = options.seed || createSeed();
  let data;

  function persist() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  if (file && fs.existsSync(file)) {
    data = normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } else {
    data = normalize(seed);
    persist();
  }

  function getUserById(id) {
    return data.users.find((user) => user.id === id) || null;
  }

  function getUserByUsername(username) {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return null;
    return data.users.find((user) => (
      user.username.toLowerCase() === key || user.id.toLowerCase() === key
    )) || null;
  }

  function getStudents() {
    return data.users
      .filter((user) => user.role === 'student')
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function getTeachers() {
    return data.users
      .filter((user) => user.role === 'teacher')
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  }

  function getCourses() {
    return [...data.courses].sort((a, b) => a.code.localeCompare(b.code));
  }

  function getCourseById(id) {
    return data.courses.find((course) => course.id === id) || null;
  }

  function getTeacherCourses(teacherId) {
    return getCourses().filter((course) => course.teacherId === teacherId);
  }

  function getEnrollmentsByStudent(studentId) {
    return data.enrollments.filter((enrollment) => enrollment.studentId === studentId);
  }

  function getEnrollmentsByCourse(courseId) {
    return data.enrollments.filter((enrollment) => enrollment.courseId === courseId);
  }

  function getEnrollment(studentId, courseId) {
    return data.enrollments.find((enrollment) => (
      enrollment.studentId === studentId && enrollment.courseId === courseId
    )) || null;
  }

  function enroll(studentId, courseId) {
    const course = getCourseById(courseId);
    if (!course) return { ok: false, error: '課程不存在' };
    if (getEnrollment(studentId, courseId)) {
      return { ok: false, error: '您已經選過這門課' };
    }

    const current = getEnrollmentsByCourse(courseId);
    if (current.length >= course.capacity) {
      return { ok: false, error: '課程已額滿' };
    }

    const myCourses = getEnrollmentsByStudent(studentId)
      .map((enrollment) => getCourseById(enrollment.courseId))
      .filter(Boolean);
    const conflict = myCourses.find((item) => coursesOverlap(item, course));
    if (conflict) {
      return { ok: false, error: `與「${conflict.name}」上課時間衝堂` };
    }

    data.enrollments.push({
      studentId,
      courseId,
      grade: null,
      enrolledAt: new Date().toISOString(),
    });
    persist();
    return { ok: true };
  }

  function drop(studentId, courseId) {
    const index = data.enrollments.findIndex((enrollment) => (
      enrollment.studentId === studentId && enrollment.courseId === courseId
    ));
    if (index === -1) return { ok: false, error: '您尚未選這門課' };
    data.enrollments.splice(index, 1);
    persist();
    return { ok: true };
  }

  function setGrade(studentId, courseId, value) {
    const enrollment = getEnrollment(studentId, courseId);
    if (!enrollment) return { ok: false, error: '找不到選課紀錄' };

    if (value == null || String(value).trim() === '') {
      enrollment.grade = null;
      persist();
      return { ok: true };
    }

    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return { ok: false, error: '成績必須是 0 到 100 的數字' };
    }

    enrollment.grade = Math.round(score * 10) / 10;
    persist();
    return { ok: true };
  }

  function createCourse(input) {
    const code = String(input.code || '').trim().toUpperCase();
    const name = String(input.name || '').trim();
    const teacherId = String(input.teacherId || '').trim();
    const credits = Number(input.credits);
    const day = Number(input.day);
    const start = Number(input.start);
    const end = Number(input.end);
    const capacity = Number(input.capacity);
    const room = String(input.room || '').trim();
    const description = String(input.description || '').trim();

    if (!/^[A-Z0-9_-]{2,12}$/.test(code)) {
      return { ok: false, error: '課程代碼格式不正確（2-12 個英數字）' };
    }
    if (!name) return { ok: false, error: '請輸入課程名稱' };
    if (!Number.isInteger(credits) || credits < 1 || credits > 10) {
      return { ok: false, error: '學分數必須是 1 到 10 的整數' };
    }
    if (!Number.isInteger(day) || day < 1 || day > 5) {
      return { ok: false, error: '上課星期必須是週一到週五' };
    }
    if (!Number.isInteger(start) || start < 1 || start > 8) {
      return { ok: false, error: '開始節次必須是 1 到 8' };
    }
    if (!Number.isInteger(end) || end < 1 || end > 8 || end < start) {
      return { ok: false, error: '結束節次必須大於等於開始節次（1 到 8）' };
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
      return { ok: false, error: '人數上限必須是 1 到 500 的整數' };
    }

    const teacher = data.users.find((user) => user.id === teacherId && user.role === 'teacher');
    if (!teacher) return { ok: false, error: '請選擇有效的授課教師' };

    if (data.courses.some((course) => course.code.toUpperCase() === code)) {
      return { ok: false, error: '課程代碼已存在' };
    }

    const draft = { code, name, teacherId, credits, day, start, end, room, capacity, description };
    const conflict = data.courses.find((course) => (
      course.teacherId === teacherId && coursesOverlap(course, draft)
    ));
    if (conflict) {
      return { ok: false, error: `教師在該時段已有課程「${conflict.name}」` };
    }

    const course = { id: code, ...draft };
    data.courses.push(course);
    persist();
    return { ok: true, course };
  }

  function deleteCourse(id) {
    const index = data.courses.findIndex((course) => course.id === id);
    if (index === -1) return { ok: false, error: '課程不存在' };
    const [removed] = data.courses.splice(index, 1);
    data.enrollments = data.enrollments.filter((enrollment) => enrollment.courseId !== id);
    persist();
    return { ok: true, course: removed };
  }

  function getAnnouncements() {
    return [...data.announcements].sort((a, b) => (
      b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
    ));
  }

  function addAnnouncement(input) {
    const title = String(input.title || '').trim();
    const content = String(input.content || '').trim();
    if (!title) return { ok: false, error: '請輸入公告標題' };
    if (!content) return { ok: false, error: '請輸入公告內容' };

    const now = new Date();
    data.announcements.push({
      id: `A${now.getTime()}${Math.floor(Math.random() * 1000)}`,
      title,
      content,
      author: String(input.author || '系統'),
      date: now.toISOString().slice(0, 10),
    });
    persist();
    return { ok: true };
  }

  function getStats() {
    return {
      students: data.users.filter((user) => user.role === 'student').length,
      teachers: data.users.filter((user) => user.role === 'teacher').length,
      courses: data.courses.length,
      enrollments: data.enrollments.length,
      graded: data.enrollments.filter((enrollment) => enrollment.grade != null).length,
      announcements: data.announcements.length,
    };
  }

  return {
    getUserById,
    getUserByUsername,
    getStudents,
    getTeachers,
    getCourses,
    getCourseById,
    getTeacherCourses,
    getEnrollmentsByStudent,
    getEnrollmentsByCourse,
    getEnrollment,
    enroll,
    drop,
    setGrade,
    createCourse,
    deleteCourse,
    getAnnouncements,
    addAnnouncement,
    getStats,
  };
}
