// schedule.js 테스트 — 실행: node extension/test/schedule.test.js
// 날짜 기준: 2026-11-23(월) ~ 2026-11-29(일), 시간은 로컬 시각
"use strict";
var path = require("path");
var S = require(path.join(__dirname, "..", "js", "schedule.js"));
var sample = require(path.join(__dirname, "..", "sample-profile.json"));

var pass = 0, fail = 0;
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "\n     기대: " + JSON.stringify(expected) + "\n     실제: " + JSON.stringify(actual)));
}
// d: 23=월 24=화 25=수 26=목 27=금 28=토 29=일
function at(d, h, m, s) { return new Date(2026, 10, d, h, m || 0, s || 0); }
function profile(classes) { return { version: 1, classes: classes }; }
function cls(name, day, start, end) { return { id: name, name: name, day: day, start: start, end: end, room: "" }; }
// 예시 데이터에는 시연용 토 · 일 수업이 있음 → 주 넘김 · 월~금 시간표 검사는 토 · 일을 뺀 평일 버전으로
var weekday = profile(sample.classes.filter(function (c) { return c.day >= 1 && c.day <= 5; }));

// ---- 날짜 전제
check("전제: 11/23은 월요일", at(23, 0).getDay(), 1);

// ---- 시각 변환
check("toMin 09:00", S.toMin("09:00"), 540);
check("toMin 23:59", S.toMin("23:59"), 1439);
check("toMin '9:00'은 NaN", isNaN(S.toMin("9:00")), true);
check("toMin '24:00'은 NaN", isNaN(S.toMin("24:00")), true);
check("fmtHMS 3600", S.fmtHMS(3600), "01:00:00");
check("fmtHMS 음수 → 0", S.fmtHMS(-5), "00:00:00");
check("fmtHM 545", S.fmtHM(545), "09:05");

// ---- 검증
check("검증: 예시 데이터 통과", S.validateProfile(sample), null);
check("검증: version 없음", typeof S.validateProfile({ classes: [] }), "string");
check("검증: '9:00' 형식", typeof S.validateProfile(profile([cls("A", 1, "9:00", "10:00")])), "string");
check("검증: 시작 ≥ 종료", typeof S.validateProfile(profile([cls("A", 1, "10:00", "10:00")])), "string");
check("검증: 요일 7", typeof S.validateProfile(profile([cls("A", 7, "09:00", "10:00")])), "string");
check("검증: 과목명 빈칸", typeof S.validateProfile(profile([cls(" ", 1, "09:00", "10:00")])), "string");
check("검증: null", typeof S.validateProfile(null), "string");

// ---- 요일별 정렬 (예시 데이터의 목요일은 13:00이 09:00보다 먼저 적혀 있음)
check("classesOn 목요일 시작순 정렬", S.classesOn(sample, 4).map(function (c) { return c.start; }), ["09:00", "13:00"]);

// ---- 오늘 상태 (월: 09:00-10:15 자료구조, 13:00-14:15 운영체제)
var st = S.getTodayStatus(sample, at(23, 8, 0));
check("수업 전 08:00 → before", st.state, "before");
check("수업 전 08:00 → 다음 자료구조", st.next.name, "자료구조");
check("수업 전 08:00 → 01:00:00", S.fmtHMS(st.secToNext), "01:00:00");
check("수업 전 08:00 → 남은 수업 2개", st.remaining.length, 2);

st = S.getTodayStatus(sample, at(23, 8, 59, 30));
check("08:59:30 → 00:00:30", S.fmtHMS(st.secToNext), "00:00:30");

st = S.getTodayStatus(sample, at(23, 9, 0, 0));
check("정확히 09:00 → inClass", st.state, "inClass");

st = S.getTodayStatus(sample, at(23, 9, 30));
check("수업 중 09:30 → inClass", st.state, "inClass");
check("수업 중 09:30 → 현재 자료구조", st.current.name, "자료구조");
check("수업 중 09:30 → 45분 남음", st.minLeftInCurrent, 45);
check("수업 중 09:30 → 다음 운영체제", st.next.name, "운영체제");
check("수업 중 09:30 → 남은 수업 2개(현재 포함)", st.remaining.length, 2);

st = S.getTodayStatus(sample, at(23, 10, 14, 30));
check("10:14:30 → 1분 남음(올림)", st.minLeftInCurrent, 1);

st = S.getTodayStatus(sample, at(23, 10, 15, 0));
check("정확히 종료 10:15 → gap", st.state, "gap");

st = S.getTodayStatus(sample, at(23, 11, 0));
check("공강 11:00 → gap", st.state, "gap");
check("공강 11:00 → 다음 운영체제 02:00:00", [st.next.name, S.fmtHMS(st.secToNext)], ["운영체제", "02:00:00"]);
check("공강 11:00 → 남은 수업 1개", st.remaining.length, 1);

st = S.getTodayStatus(sample, at(23, 15, 0));
check("수업 끝 15:00 → done", st.state, "done");
check("수업 끝 → 내일 10:30 컴퓨터비전", [st.upcoming.label, st.upcoming.first.start, st.upcoming.first.name], ["내일", "10:30", "컴퓨터비전"]);
check("수업 끝 → 남은 수업 0개", st.remaining.length, 0);

st = S.getTodayStatus(sample, at(25, 10, 0));
check("수업 없는 수요일 → noClass", st.state, "noClass");
check("수요일 → 내일 자료구조", [st.upcoming.label, st.upcoming.first.name], ["내일", "자료구조"]);

st = S.getTodayStatus(weekday, at(27, 13, 0));
check("금 수업 끝 → 월요일(주 넘김)", [st.state, st.upcoming.label, st.upcoming.offset], ["done", "월요일", 3]);

st = S.getTodayStatus(weekday, at(28, 10, 0));
check("토요일 → noClass, 월요일", [st.state, st.upcoming.label], ["noClass", "월요일"]);

st = S.getTodayStatus(sample, at(28, 14, 48));
check("예시 토요일 14:48 → 인공지능까지 00:42:00", [st.state, st.next.name, S.fmtHMS(st.secToNext)], ["gap", "인공지능", "00:42:00"]);

st = S.getTodayStatus(sample, at(28, 20, 0));
check("예시 토요일 수업 끝 → 내일 09:30 알고리즘", [st.state, st.upcoming.label, st.upcoming.first.start, st.upcoming.first.name], ["done", "내일", "09:30", "알고리즘"]);

st = S.getTodayStatus(sample, at(29, 11, 0));
check("예시 일요일 11:00 → 공강, 웹프로그래밍까지 01:00:00", [st.state, st.next.name, S.fmtHMS(st.secToNext)], ["gap", "웹프로그래밍", "01:00:00"]);

var mondayOnly = profile([cls("A", 1, "09:00", "10:00")]);
st = S.getTodayStatus(mondayOnly, at(23, 12, 0));
check("월요일만 수업, 월 수업 끝 → 다음 주 월요일", [st.upcoming.label, st.upcoming.offset], ["다음 주 월요일", 7]);

st = S.getTodayStatus(profile([]), at(23, 9, 0));
check("수업 0개 → empty", st.state, "empty");

// ---- 미니 시간표
// ---- 수업 N분 전 알림
function rem(p, date, lead) {
  var r = S.findNextReminder(p, date, lead);
  if (!r) return null;
  var n = new Date(r.notifyAt);
  return [r.cls.name, (n.getMonth() + 1) + "/" + n.getDate() + " " + S.fmtHM(n.getHours() * 60 + n.getMinutes()), r.startAt - r.notifyAt];
}
function rem2(p, date, lead, keys) {
  var r = S.findNextReminder(p, date, lead, keys);
  if (!r) return null;
  var n = new Date(r.notifyAt);
  return [r.cls.name, (n.getMonth() + 1) + "/" + n.getDate() + " " + S.fmtHM(n.getHours() * 60 + n.getMinutes()), r.late];
}
var sameTime = profile([cls("A", 1, "09:00", "10:00"), cls("B", 1, "09:00", "10:30")]);
check("알림: 월 08:00, 10분 전 → 자료구조 11/23 08:50", rem(sample, at(23, 8, 0), 10), ["자료구조", "11/23 08:50", 600000]);
check("알림: 15분 전 → 08:45", rem(sample, at(23, 8, 0), 15), ["자료구조", "11/23 08:45", 900000]);
check("알림: 08:49:59 → 자료구조 예약(late 아님)", S.findNextReminder(sample, at(23, 8, 49, 59), 10).late, false);
// 알림 시각이 지났지만 수업 시작 전 → 그 수업을 late로 (바로 1회 알림, 대시보드 A-3과 같음)
check("알림: 08:53(7분 전에 켬) → 자료구조 late", [rem(sample, at(23, 8, 53), 10)[0], S.findNextReminder(sample, at(23, 8, 53), 10).late], ["자료구조", true]);
check("알림: 정확히 08:50 → 자료구조 late", S.findNextReminder(sample, at(23, 8, 50, 0), 10).late, true);
check("알림: 08:59:59(1초 전) → 자료구조 late", S.findNextReminder(sample, at(23, 8, 59, 59), 10).cls.name, "자료구조");
check("알림: 정확히 09:00(시작) → 다음 운영체제, late 아님", [rem(sample, at(23, 9, 0), 10)[0], S.findNextReminder(sample, at(23, 9, 0), 10).late], ["운영체제", false]);
check("알림: 09:30(수업 중) → 다음 운영체제", rem(sample, at(23, 9, 30), 10), ["운영체제", "11/23 12:50", 600000]);
// 이미 알린 수업(key)은 건너뜀 → 같은 수업 두 번 알리지 않음
check("알림: 08:53, 자료구조 알림 보냄 → 다음 운영체제 12:50", rem2(sample, at(23, 8, 53), 10, ["2026-11-23|c1|09:00"]), ["운영체제", "11/23 12:50", false]);
check("알림: 08:50 울린 직후(자료구조 기록) → 운영체제", rem2(sample, at(23, 8, 50), 10, ["2026-11-23|c1|09:00"])[0], "운영체제");
check("알림: 다른 날 key는 영향 없음", rem2(sample, at(23, 8, 53), 10, ["2026-11-16|c1|09:00"]), ["자료구조", "11/23 08:50", true]);
check("알림: 같은 시각 두 수업 → 둘 다 한 번씩", [
  rem2(sameTime, at(23, 8, 55), 10, [])[0],
  rem2(sameTime, at(23, 8, 55), 10, ["2026-11-23|A|09:00"])[0],
  rem2(sameTime, at(23, 8, 55), 10, ["2026-11-23|A|09:00", "2026-11-23|B|09:00"])[0]
], ["A", "B", "A"]);
check("알림: 15분 전 설정, 08:50 → 자료구조 late", S.findNextReminder(sample, at(23, 8, 50), 15).late, true);
check("알림: 5분 전 설정, 08:50 → 자료구조 예약", S.findNextReminder(sample, at(23, 8, 50), 5).late, false);
check("알림: 예시 토 15:23(7분 전) → 인공지능 late", [rem(sample, at(28, 15, 23), 10)[0], S.findNextReminder(sample, at(28, 15, 23), 10).late], ["인공지능", true]);
check("알림: 월 15:00 → 화 10:20 컴퓨터비전", rem(sample, at(23, 15, 0), 10), ["컴퓨터비전", "11/24 10:20", 600000]);
check("알림: 예시 토 14:48 → 토 15:20 인공지능", rem(sample, at(28, 14, 48), 10), ["인공지능", "11/28 15:20", 600000]);
check("알림: 예시 토 20:00 → 일 09:20 알고리즘", rem(sample, at(28, 20, 0), 10), ["알고리즘", "11/29 09:20", 600000]);
check("알림: 평일 버전 금 13:00 → 월 08:50 (주 넘김)", rem(weekday, at(27, 13, 0), 10), ["자료구조", "11/30 08:50", 600000]);
check("알림: 월 11/30 15:00 → 화 12/1 (월 넘김)", rem(sample, at(30, 15, 0), 10), ["컴퓨터비전", "12/1 10:20", 600000]);
check("알림: 월요일만, 월 12:00 → 다음 주 월 08:50", rem(mondayOnly, at(23, 12, 0), 10), ["A", "11/30 08:50", 600000]);
check("알림: 수업 0개 → null", S.findNextReminder(profile([]), at(23, 8, 0), 10), null);
check("알림: key 형식", S.findNextReminder(sample, at(23, 8, 0), 10).key, "2026-11-23|c1|09:00");

// ---- 미니 시간표
var g = S.buildWeekGrid(weekday, 1);
check("주간: 월~금만", g.days, [1, 2, 3, 4, 5]);
check("주간: 9시~17시", [g.startHour, g.endHour], [9, 17]);
check("주간: 월요일 강조", g.columns[0].isToday, true);
check("주간: 월 첫 블록 top 0%", g.columns[0].blocks[0].topPct, 0);
check("주간: 75분 / 8시간 = 15.625%", g.columns[0].blocks[0].heightPct, 15.625);

g = S.buildWeekGrid(sample, 0);
check("주간: 예시 → 토 · 일 칸 추가, 9시~20시, 일요일 강조", [g.days, g.startHour, g.endHour, g.columns[6].isToday], [[1, 2, 3, 4, 5, 6, 0], 9, 20, true]);

g = S.buildWeekGrid(profile([cls("A", 1, "09:00", "10:00"), cls("B", 6, "10:00", "11:00"), cls("C", 0, "08:30", "09:00")]), 0);
check("주간: 토 · 일 수업 있으면 추가(일요일 맨 뒤)", g.days, [1, 2, 3, 4, 5, 6, 0]);
check("주간: 8:30 시작 → 8시부터", g.startHour, 8);
check("주간: 일요일 강조", g.columns[6].isToday, true);

g = S.buildWeekGrid(profile([]), 3);
check("주간: 수업 없으면 9~18시", [g.days.length, g.startHour, g.endHour], [5, 9, 18]);

console.log("\n" + pass + "개 PASS, " + fail + "개 FAIL");
process.exit(fail ? 1 : 0);
