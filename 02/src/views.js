import { DAY_NAMES, PERIOD_TIMES, formatCourseTime } from './domain.js';

const ROLE_LABELS = { student: '學生', teacher: '教師', admin: '管理員' };

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function navItems(role) {
  if (role === 'student') {
    return [
      ['/dashboard', '儀表板', 'dashboard'],
      ['/courses', '選課', 'courses'],
      ['/timetable', '課表', 'timetable'],
      ['/grades', '成績', 'grades'],
      ['/profile', '個人資料', 'profile'],
      ['/announcements', '公告', 'announcements'],
    ];
  }
  if (role === 'teacher') {
    return [
      ['/dashboard', '儀表板', 'dashboard'],
      ['/teacher/courses', '我的課程', 'courses'],
      ['/announcements', '公告', 'announcements'],
    ];
  }
  return [
    ['/dashboard', '儀表板', 'dashboard'],
    ['/admin/courses', '課程管理', 'courses'],
    ['/admin/students', '學生名單', 'students'],
    ['/announcements', '公告', 'announcements'],
  ];
}

function flashHtml(flash) {
  if (!flash) return '';
  const type = flash.type === 'error' ? 'alert-error' : 'alert-ok';
  return `<div class="alert ${type}">${esc(flash.message)}</div>`;
}

function statCard(label, value, hint) {
  return `<div class="stat"><span class="stat-label">${esc(label)}</span>`
    + `<strong class="stat-value">${esc(value)}</strong>`
    + `<span class="stat-hint">${esc(hint || '')}</span></div>`;
}

function toneClass(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash + ch.charCodeAt(0)) % 5;
  return `tone-${hash + 1}`;
}

function options(items, selected) {
  return items.map(([value, label]) => {
    const isSelected = String(value) === String(selected) ? ' selected' : '';
    return `<option value="${esc(value)}"${isSelected}>${esc(label)}</option>`;
  }).join('');
}

function layout({ user, title, active, flash, content }) {
  const nav = navItems(user.role).map(([href, label, key]) => (
    `<a class="nav-link${key === active ? ' active' : ''}" href="${href}">${esc(label)}</a>`
  )).join('');

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | 金門大學校務系統</title>
<link rel="stylesheet" href="/static/styles.css">
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark">金</span>
      <div class="brand-text"><strong>金門大學</strong><small>校務系統 Demo</small></div>
    </div>
    <nav class="nav">${nav}</nav>
    <div class="sidebar-note">
      <span class="dot"></span>
      <span>115 學年度第 1 學期</span>
    </div>
  </aside>
  <main class="main">
    <header class="topbar">
      <div class="topbar-title">
        <p class="eyebrow">${esc(roleLabel(user.role))}專區</p>
        <h1>${esc(title)}</h1>
      </div>
      <div class="topbar-actions">
        <span class="user-chip">
          <span class="avatar">${esc(user.name.slice(0, 1))}</span>
          <span class="user-meta"><strong>${esc(user.name)}</strong><small>${esc(user.id)}</small></span>
        </span>
        <form method="post" action="/logout">
          <button class="btn btn-ghost btn-sm" type="submit">登出</button>
        </form>
      </div>
    </header>
    ${flashHtml(flash)}
    ${content}
    <footer class="footer">國立金門大學校務系統示範專案 · 資料僅供教學使用</footer>
  </main>
</div>
</body>
</html>`;
}

export function loginPage({ error } = {}) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登入 | 金門大學校務系統</title>
<link rel="stylesheet" href="/static/styles.css">
</head>
<body class="login-body">
<div class="login-wrap">
  <div class="login-card">
    <div class="login-brand">
      <span class="brand-mark large">金</span>
      <h1>金門大學校務系統</h1>
      <p>National Quemoy University Student Information System</p>
    </div>
    ${error ? `<div class="alert alert-error">${esc(error)}</div>` : ''}
    <form method="post" action="/login" class="login-form">
      <label>帳號
        <input class="input" name="username" autocomplete="username" required autofocus placeholder="例如 s11501001">
      </label>
      <label>密碼
        <input class="input" type="password" name="password" autocomplete="current-password" required placeholder="請輸入密碼">
      </label>
      <button class="btn btn-primary btn-block" type="submit">登入</button>
    </form>
    <div class="demo-accounts">
      <strong>示範帳號</strong>
      <span>學生：<code>s11501001</code> / <code>1234</code></span>
      <span>教師：<code>t001</code> / <code>1234</code></span>
      <span>管理員：<code>admin</code> / <code>admin123</code></span>
    </div>
  </div>
  <p class="login-footer">Demo 專案，資料僅供教學測試使用</p>
</div>
</body>
</html>`;
}

export function studentDashboard({ user, entries, summary, pending, announcements, flash }) {
  const gpa = summary.gpa == null ? '—' : summary.gpa.toFixed(2);
  const courseItems = entries.length
    ? entries.map(({ course, teacher, enrollment }) => {
      const status = enrollment.grade == null
        ? '<span class="badge badge-muted">未評分</span>'
        : `<span class="badge badge-ok">${esc(enrollment.grade)} 分</span>`;
      return `<li class="course-item">
        <span class="course-code">${esc(course.code)}</span>
        <span class="course-main"><strong>${esc(course.name)}</strong><small>${esc(formatCourseTime(course))} · ${esc(course.room)}</small></span>
        <span class="muted small">${esc(teacher ? teacher.name : '')}</span>
        ${status}
      </li>`;
    }).join('')
    : '<li class="empty-cell">尚未選課，前往選課頁面挑選課程。</li>';

  const news = announcements.length
    ? announcements.map((item) => (
      `<li class="news-item"><strong>${esc(item.title)}</strong><small>${esc(item.date)} · ${esc(item.author)}</small></li>`
    )).join('')
    : '<li class="empty-cell">目前沒有公告。</li>';

  const content = `
<div class="stats">
  ${statCard('已選課程', entries.length, '門')}
  ${statCard('已選學分', summary.totalCredits, '學分')}
  ${statCard('學期 GPA', gpa, '已評分課程')}
  ${statCard('待評分', pending, '門')}
</div>
<div class="grid-2">
  <section class="panel">
    <div class="panel-head"><h2>本學期課程</h2><a class="link" href="/courses">前往選課</a></div>
    <ul class="course-list">${courseItems}</ul>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>最新公告</h2><a class="link" href="/announcements">全部公告</a></div>
    <ul class="news-list">${news}</ul>
  </section>
</div>
<section class="panel">
  <div class="panel-head"><h2>快速連結</h2></div>
  <div class="quick-links">
    <a class="quick-link" href="/timetable"><strong>課表</strong><span>查看本週上課時間</span></a>
    <a class="quick-link" href="/grades"><strong>成績</strong><span>查詢成績與 GPA</span></a>
    <a class="quick-link" href="/profile"><strong>個人資料</strong><span>檢視學籍資料</span></a>
  </div>
</section>`;

  return layout({ user, title: '學生儀表板', active: 'dashboard', flash, content });
}

export function teacherDashboard({ user, rows, studentCount, flash }) {
  const pending = rows.reduce((sum, row) => sum + (row.count - row.graded), 0);
  const table = rows.length
    ? rows.map(({ course, count, graded }) => `
      <tr>
        <td><span class="course-code">${esc(course.code)}</span></td>
        <td><a class="link" href="/teacher/courses/${esc(course.id)}">${esc(course.name)}</a></td>
        <td>${esc(formatCourseTime(course))}</td>
        <td>${esc(course.room)}</td>
        <td>${count} / ${esc(course.capacity)}</td>
        <td>${graded} / ${count}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="empty-cell">目前沒有開設課程。</td></tr>';

  const content = `
<div class="stats">
  ${statCard('開設課程', rows.length, '門')}
  ${statCard('修課學生', studentCount, '人')}
  ${statCard('待輸入成績', pending, '筆')}
</div>
<section class="panel">
  <div class="panel-head"><h2>我的課程</h2><a class="link" href="/teacher/courses">課程管理</a></div>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>代碼</th><th>課程名稱</th><th>上課時間</th><th>教室</th><th>選課人數</th><th>成績輸入</th></tr></thead>
      <tbody>${table}</tbody>
    </table>
  </div>
</section>`;

  return layout({ user, title: '教師儀表板', active: 'dashboard', flash, content });
}

export function adminDashboard({ user, stats, recentCourses, announcements, flash }) {
  const courseRows = recentCourses.length
    ? recentCourses.map(({ course, teacher, count }) => `
      <tr>
        <td><span class="course-code">${esc(course.code)}</span></td>
        <td>${esc(course.name)}</td>
        <td>${esc(teacher ? teacher.name : '')}</td>
        <td>${esc(formatCourseTime(course))}</td>
        <td>${count} / ${esc(course.capacity)}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty-cell">目前沒有課程。</td></tr>';

  const news = announcements.length
    ? announcements.map((item) => (
      `<li class="news-item"><strong>${esc(item.title)}</strong><small>${esc(item.date)} · ${esc(item.author)}</small></li>`
    )).join('')
    : '<li class="empty-cell">目前沒有公告。</li>';

  const content = `
<div class="stats">
  ${statCard('學生人數', stats.students, '人')}
  ${statCard('教師人數', stats.teachers, '人')}
  ${statCard('課程數', stats.courses, '門')}
  ${statCard('選課筆數', stats.enrollments, '筆')}
</div>
<div class="grid-2">
  <section class="panel">
    <div class="panel-head"><h2>課程概況</h2><a class="link" href="/admin/courses">課程管理</a></div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>代碼</th><th>課程</th><th>教師</th><th>時間</th><th>人數</th></tr></thead>
        <tbody>${courseRows}</tbody>
      </table>
    </div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>最新公告</h2><a class="link" href="/announcements">全部公告</a></div>
    <ul class="news-list">${news}</ul>
  </section>
</div>`;

  return layout({ user, title: '管理員儀表板', active: 'dashboard', flash, content });
}

export function coursesPage({ user, rows, q, flash }) {
  const body = rows.length
    ? rows.map(({ course, teacher, count, enrolled }) => {
      let action;
      if (enrolled) {
        action = `<span class="badge badge-ok">已選課</span>
          <form method="post" action="/courses/${esc(course.id)}/drop" class="inline-form">
            <button class="btn btn-sm btn-ghost" type="submit">退選</button>
          </form>`;
      } else if (count >= course.capacity) {
        action = '<span class="badge badge-warn">額滿</span>';
      } else {
        action = `<form method="post" action="/courses/${esc(course.id)}/enroll" class="inline-form">
          <button class="btn btn-sm btn-primary" type="submit">選課</button>
        </form>`;
      }
      return `<tr>
        <td><span class="course-code">${esc(course.code)}</span></td>
        <td><strong>${esc(course.name)}</strong><br><small class="muted">${esc(course.description)}</small></td>
        <td>${esc(teacher ? teacher.name : '')}</td>
        <td>${esc(course.credits)}</td>
        <td>${esc(formatCourseTime(course))}</td>
        <td>${esc(course.room)}</td>
        <td><span class="${count >= course.capacity ? 'text-warn' : ''}">${count} / ${esc(course.capacity)}</span></td>
        <td class="actions">${action}</td>
      </tr>`;
    }).join('')
    : '<tr><td colspan="8" class="empty-cell">找不到符合條件的課程。</td></tr>';

  const content = `
<section class="panel">
  <div class="panel-head"><h2>課程查詢</h2><span class="muted">共 ${rows.length} 門課程</span></div>
  <form method="get" action="/courses" class="search-bar">
    <input class="input" name="q" value="${esc(q)}" placeholder="搜尋課程名稱、代碼或教師">
    <button class="btn btn-primary" type="submit">搜尋</button>
    ${q ? '<a class="btn btn-ghost" href="/courses">清除</a>' : ''}
  </form>
</section>
<section class="panel">
  <div class="panel-head"><h2>開課列表</h2><a class="link" href="/timetable">查看我的課表</a></div>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>代碼</th><th>課程名稱</th><th>教師</th><th>學分</th><th>上課時間</th><th>教室</th><th>人數</th><th>操作</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</section>`;

  return layout({ user, title: '選課', active: 'courses', flash, content });
}

export function timetablePage({ user, entries, flash }) {
  const grid = new Map();
  for (const entry of entries) {
    for (let period = entry.course.start; period <= entry.course.end; period += 1) {
      grid.set(`${entry.course.day}-${period}`, entry);
    }
  }

  const days = [1, 2, 3, 4, 5];
  let rows = '';
  for (let period = 1; period <= 8; period += 1) {
    let cells = '';
    for (const day of days) {
      const entry = grid.get(`${day}-${period}`);
      if (!entry) {
        cells += '<td class="slot empty"></td>';
        continue;
      }
      if (entry.course.start !== period) continue;
      const span = entry.course.end - entry.course.start + 1;
      cells += `<td rowspan="${span}" class="slot ${toneClass(entry.course.id)}">
        <strong>${esc(entry.course.name)}</strong>
        <span>${esc(entry.course.room)}</span>
        <small>${esc(entry.teacher ? entry.teacher.name : '')}</small>
      </td>`;
    }
    rows += `<tr><th class="period"><strong>第 ${period} 節</strong><small>${esc(PERIOD_TIMES[period])}</small></th>${cells}</tr>`;
  }

  const content = `
<section class="panel">
  <div class="panel-head"><h2>本學期課表</h2><a class="link" href="/courses">前往選課</a></div>
  ${entries.length ? '' : '<div class="alert alert-ok">目前尚未選課，課表是空的。</div>'}
  <div class="table-wrap">
    <table class="timetable">
      <thead><tr><th class="period">節次</th>${days.map((day) => `<th>${esc(DAY_NAMES[day])}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</section>`;

  return layout({ user, title: '課表', active: 'timetable', flash, content });
}

export function gradesPage({ user, rows, summary, flash }) {
  const gpa = summary.gpa == null ? '—' : summary.gpa.toFixed(2);
  const body = rows.length
    ? rows.map(({ course, score, info }) => {
      let status;
      if (score == null) status = '<span class="badge badge-muted">未評分</span>';
      else if (Number(score) >= 60) status = '<span class="badge badge-ok">及格</span>';
      else status = '<span class="badge badge-error">不及格</span>';
      return `<tr>
        <td><span class="course-code">${esc(course.code)}</span></td>
        <td>${esc(course.name)}</td>
        <td>${esc(course.credits)}</td>
        <td>${score == null ? '—' : esc(score)}</td>
        <td>${info ? esc(info.letter) : '—'}</td>
        <td>${info ? esc(info.points.toFixed(1)) : '—'}</td>
        <td>${status}</td>
      </tr>`;
    }).join('')
    : '<tr><td colspan="7" class="empty-cell">目前沒有選課紀錄。</td></tr>';

  const content = `
<div class="stats">
  ${statCard('學期 GPA', gpa, '4.3 制')}
  ${statCard('已評分學分', summary.gradedCredits, '學分')}
  ${statCard('已評分課程', summary.gradedCount, '門')}
  ${statCard('選課總數', summary.totalCount, '門')}
</div>
<section class="panel">
  <div class="panel-head"><h2>成績明細</h2><span class="muted">成績由授課教師輸入</span></div>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>代碼</th><th>課程名稱</th><th>學分</th><th>成績</th><th>等第</th><th>積分</th><th>狀態</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
  <p class="note">等第換算：A+ 4.3、A 4.0、A- 3.7、B+ 3.3、B 3.0、B- 2.7、C+ 2.3、C 2.0、F 0。</p>
</section>`;

  return layout({ user, title: '成績查詢', active: 'grades', flash, content });
}

export function profilePage({ user, rows, summary, flash }) {
  const gpa = summary.gpa == null ? '—' : summary.gpa.toFixed(2);
  const body = rows.length
    ? rows.map(({ course, score }) => `
      <tr>
        <td><span class="course-code">${esc(course.code)}</span></td>
        <td>${esc(course.name)}</td>
        <td>${esc(course.credits)}</td>
        <td>${esc(formatCourseTime(course))}</td>
        <td>${esc(course.room)}</td>
        <td>${score == null ? '未評分' : esc(score)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="empty-cell">目前沒有選課紀錄。</td></tr>';

  const content = `
<div class="grid-2">
  <section class="panel">
    <div class="panel-head"><h2>學籍資料</h2></div>
    <dl class="info-list">
      <dt>姓名</dt><dd>${esc(user.name)}</dd>
      <dt>學號</dt><dd>${esc(user.id)}</dd>
      <dt>系所</dt><dd>${esc(user.department)}</dd>
      <dt>年級</dt><dd>${esc(user.year)}</dd>
      <dt>電子郵件</dt><dd>${esc(user.email)}</dd>
      <dt>身分</dt><dd>${esc(roleLabel(user.role))}</dd>
    </dl>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>學期摘要</h2></div>
    <dl class="info-list">
      <dt>選課數</dt><dd>${summary.totalCount} 門</dd>
      <dt>選課學分</dt><dd>${summary.totalCredits} 學分</dd>
      <dt>已評分學分</dt><dd>${summary.gradedCredits} 學分</dd>
      <dt>學期 GPA</dt><dd>${esc(gpa)}</dd>
    </dl>
  </section>
</div>
<section class="panel">
  <div class="panel-head"><h2>選課紀錄</h2><a class="link" href="/grades">查看成績</a></div>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>代碼</th><th>課程名稱</th><th>學分</th><th>上課時間</th><th>教室</th><th>成績</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</section>`;

  return layout({ user, title: '個人資料', active: 'profile', flash, content });
}

export function teacherCoursesPage({ user, rows, flash }) {
  const body = rows.length
    ? rows.map(({ course, count, graded }) => `
      <tr>
        <td><span class="course-code">${esc(course.code)}</span></td>
        <td><strong>${esc(course.name)}</strong><br><small class="muted">${esc(course.description)}</small></td>
        <td>${esc(course.credits)}</td>
        <td>${esc(formatCourseTime(course))}</td>
        <td>${esc(course.room)}</td>
        <td>${count} / ${esc(course.capacity)}</td>
        <td>${graded} / ${count}</td>
        <td><a class="btn btn-sm btn-ghost" href="/teacher/courses/${esc(course.id)}">管理</a></td>
      </tr>`).join('')
    : '<tr><td colspan="8" class="empty-cell">目前沒有開設課程。</td></tr>';

  const content = `
<section class="panel">
  <div class="panel-head"><h2>我的課程</h2><span class="muted">共 ${rows.length} 門</span></div>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>代碼</th><th>課程名稱</th><th>學分</th><th>上課時間</th><th>教室</th><th>人數</th><th>成績輸入</th><th>操作</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</section>`;

  return layout({ user, title: '我的課程', active: 'courses', flash, content });
}

export function teacherCoursePage({ user, course, teacher, roster, flash }) {
  const rows = roster.length
    ? roster.map(({ student, enrollment }) => {
      const value = enrollment.grade == null ? '' : enrollment.grade;
      return `<tr>
        <td><span class="course-code">${esc(student.id)}</span></td>
        <td>${esc(student.name)}</td>
        <td>${esc(student.department)}</td>
        <td>${esc(student.year)}</td>
        <td><input class="input grade-input" type="number" name="grade_${esc(student.id)}" value="${esc(value)}" min="0" max="100" step="0.1" placeholder="未評分"></td>
      </tr>`;
    }).join('')
    : '<tr><td colspan="5" class="empty-cell">目前沒有學生選課。</td></tr>';

  const content = `
<section class="panel course-header">
  <div>
    <span class="course-code">${esc(course.code)}</span>
    <h2>${esc(course.name)}</h2>
    <p class="muted">${esc(course.description)}</p>
  </div>
  <dl class="info-list compact">
    <dt>授課教師</dt><dd>${esc(teacher ? teacher.name : '')}</dd>
    <dt>上課時間</dt><dd>${esc(formatCourseTime(course))}</dd>
    <dt>教室</dt><dd>${esc(course.room)}</dd>
    <dt>學分</dt><dd>${esc(course.credits)}</dd>
    <dt>選課人數</dt><dd>${roster.length} / ${esc(course.capacity)}</dd>
  </dl>
</section>
<section class="panel">
  <div class="panel-head"><h2>學生名單與成績</h2><span class="muted">輸入 0-100 分，留空表示尚未評分</span></div>
  <form method="post" action="/teacher/courses/${esc(course.id)}/grades">
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>學號</th><th>姓名</th><th>系所</th><th>年級</th><th>成績</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">儲存成績</button>
    </div>
  </form>
</section>`;

  return layout({ user, title: `${course.code} ${course.name}`, active: 'courses', flash, content });
}

export function adminCoursesPage({ user, rows, teachers, flash }) {
  const body = rows.length
    ? rows.map(({ course, teacher, count }) => `
      <tr>
        <td><span class="course-code">${esc(course.code)}</span></td>
        <td><strong>${esc(course.name)}</strong><br><small class="muted">${esc(course.description)}</small></td>
        <td>${esc(teacher ? teacher.name : '')}</td>
        <td>${esc(course.credits)}</td>
        <td>${esc(formatCourseTime(course))}</td>
        <td>${esc(course.room)}</td>
        <td>${count} / ${esc(course.capacity)}</td>
        <td>
          <form method="post" action="/admin/courses/${esc(course.id)}/delete" class="inline-form" onsubmit="return confirm('確定要刪除這門課程嗎？');">
            <button class="btn btn-sm btn-danger" type="submit">刪除</button>
          </form>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="8" class="empty-cell">目前沒有課程。</td></tr>';

  const teacherOptions = options(teachers.map((teacher) => [teacher.id, `${teacher.name}（${teacher.department}）`]), '');
  const dayOptions = options([1, 2, 3, 4, 5].map((day) => [day, DAY_NAMES[day]]), 1);
  const periodOptions = options([1, 2, 3, 4, 5, 6, 7, 8].map((period) => [period, `第 ${period} 節（${PERIOD_TIMES[period]}）`]), 1);

  const content = `
<section class="panel">
  <div class="panel-head"><h2>新增課程</h2><span class="muted">系統會檢查教師時段衝堂</span></div>
  <form method="post" action="/admin/courses" class="form-grid">
    <label>課程代碼<input class="input" name="code" required maxlength="12" placeholder="例如 CS401"></label>
    <label>課程名稱<input class="input" name="name" required placeholder="例如 人工智慧"></label>
    <label>授課教師<select class="input" name="teacherId" required>${teacherOptions}</select></label>
    <label>學分數<input class="input" type="number" name="credits" value="3" min="1" max="10" required></label>
    <label>上課星期<select class="input" name="day">${dayOptions}</select></label>
    <label>開始節次<select class="input" name="start">${periodOptions}</select></label>
    <label>結束節次<select class="input" name="end">${periodOptions}</select></label>
    <label>教室<input class="input" name="room" placeholder="例如 理工大樓 E401"></label>
    <label>人數上限<input class="input" type="number" name="capacity" value="50" min="1" max="500" required></label>
    <label class="span-2">課程簡介<input class="input" name="description" placeholder="簡短描述課程內容"></label>
    <div class="form-actions span-2"><button class="btn btn-primary" type="submit">新增課程</button></div>
  </form>
</section>
<section class="panel">
  <div class="panel-head"><h2>課程列表</h2><span class="muted">共 ${rows.length} 門</span></div>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>代碼</th><th>課程名稱</th><th>教師</th><th>學分</th><th>上課時間</th><th>教室</th><th>人數</th><th>操作</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</section>`;

  return layout({ user, title: '課程管理', active: 'courses', flash, content });
}

export function adminStudentsPage({ user, students, flash }) {
  const body = students.length
    ? students.map(({ student, count, graded }) => `
      <tr>
        <td><span class="course-code">${esc(student.id)}</span></td>
        <td>${esc(student.name)}</td>
        <td>${esc(student.department)}</td>
        <td>${esc(student.year)}</td>
        <td>${esc(student.email)}</td>
        <td>${count}</td>
        <td>${graded} / ${count}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty-cell">目前沒有學生資料。</td></tr>';

  const content = `
<section class="panel">
  <div class="panel-head"><h2>學生名單</h2><span class="muted">共 ${students.length} 人</span></div>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>學號</th><th>姓名</th><th>系所</th><th>年級</th><th>電子郵件</th><th>選課數</th><th>已評分</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</section>`;

  return layout({ user, title: '學生名單', active: 'students', flash, content });
}

export function announcementsPage({ user, announcements, flash }) {
  const canPost = user.role === 'teacher' || user.role === 'admin';
  const list = announcements.length
    ? announcements.map((item) => `
      <article class="announcement">
        <header><h2>${esc(item.title)}</h2><span class="muted">${esc(item.date)} · ${esc(item.author)}</span></header>
        <p>${esc(item.content)}</p>
      </article>`).join('')
    : '<div class="empty-cell">目前沒有公告。</div>';

  const form = canPost
    ? `<section class="panel">
        <div class="panel-head"><h2>發布公告</h2><span class="muted">以 ${esc(user.name)} 名義發布</span></div>
        <form method="post" action="/announcements" class="form-grid">
          <label class="span-2">標題<input class="input" name="title" required maxlength="80" placeholder="公告標題"></label>
          <label class="span-2">內容<textarea class="input" name="content" rows="4" required placeholder="公告內容"></textarea></label>
          <div class="form-actions span-2"><button class="btn btn-primary" type="submit">發布公告</button></div>
        </form>
      </section>`
    : '';

  const content = `
${form}
<section class="panel">
  <div class="panel-head"><h2>公告列表</h2><span class="muted">共 ${announcements.length} 則</span></div>
  <div class="announcement-list">${list}</div>
</section>`;

  return layout({ user, title: '公告', active: 'announcements', flash, content });
}

export function errorPage({ user, status, message }) {
  if (user) {
    const content = `
<section class="panel error-panel">
  <strong class="error-code">${esc(status)}</strong>
  <h2>${esc(message)}</h2>
  <p class="muted">請返回儀表板，或使用左側選單前往其他功能。</p>
  <a class="btn btn-primary" href="/dashboard">回到儀表板</a>
</section>`;
    return layout({ user, title: '發生錯誤', active: '', flash: null, content });
  }

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(status)} | 金門大學校務系統</title>
<link rel="stylesheet" href="/static/styles.css">
</head>
<body class="login-body">
<div class="login-wrap">
  <div class="login-card error-panel">
    <strong class="error-code">${esc(status)}</strong>
    <h2>${esc(message)}</h2>
    <a class="btn btn-primary" href="/login">前往登入</a>
  </div>
</div>
</body>
</html>`;
}
