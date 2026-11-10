export const DAY_NAMES = ['', '週一', '週二', '週三', '週四', '週五'];

export const PERIOD_TIMES = {
  1: '08:10-09:00',
  2: '09:10-10:00',
  3: '10:10-11:00',
  4: '11:10-12:00',
  5: '13:10-14:00',
  6: '14:10-15:00',
  7: '15:10-16:00',
  8: '16:10-17:00',
};

export function formatCourseTime(course) {
  if (!course) return '';
  const day = DAY_NAMES[course.day] || `週${course.day}`;
  if (course.start === course.end) return `${day} 第 ${course.start} 節`;
  return `${day} 第 ${course.start}-${course.end} 節`;
}

export function coursePeriods(course) {
  const periods = [];
  for (let period = course.start; period <= course.end; period += 1) {
    periods.push(period);
  }
  return periods;
}

export function coursesOverlap(a, b) {
  if (!a || !b || a.day !== b.day) return false;
  return a.start <= b.end && b.start <= a.end;
}

export function gradeInfo(score) {
  if (score == null || score === '') return null;
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  if (value >= 90) return { letter: 'A+', points: 4.3 };
  if (value >= 85) return { letter: 'A', points: 4.0 };
  if (value >= 80) return { letter: 'A-', points: 3.7 };
  if (value >= 75) return { letter: 'B+', points: 3.3 };
  if (value >= 70) return { letter: 'B', points: 3.0 };
  if (value >= 65) return { letter: 'B-', points: 2.7 };
  if (value >= 60) return { letter: 'C+', points: 2.3 };
  if (value >= 50) return { letter: 'C', points: 2.0 };
  return { letter: 'F', points: 0 };
}

export function computeGpa(enrollments, courseMap) {
  let totalCredits = 0;
  let gradedCredits = 0;
  let points = 0;
  let gradedCount = 0;

  for (const enrollment of enrollments) {
    const course = courseMap.get(enrollment.courseId);
    if (!course) continue;
    totalCredits += course.credits;
    if (enrollment.grade == null) continue;
    const info = gradeInfo(enrollment.grade);
    if (!info) continue;
    gradedCredits += course.credits;
    points += info.points * course.credits;
    gradedCount += 1;
  }

  return {
    gpa: gradedCredits ? points / gradedCredits : null,
    totalCredits,
    gradedCredits,
    gradedCount,
    totalCount: enrollments.length,
  };
}
