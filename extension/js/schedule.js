/*
 * schedule.js — 오늘 남은 수업 · 현재 수업 · 다음 수업 · 미니 시간표 계산
 *
 * - 순수 함수만 둔다: DOM · chrome.* API · 현재 시각(new Date())에 직접 접근하지 않는다.
 *   현재 시각은 항상 인자(now)로 받는다 → 테스트와 ?now= 시연이 쉬움.
 * - 입력은 plan.md 2-1 프로필 형식 그대로 ({ version: 1, classes: [{ id, name, day, start, end, room }] }).
 *   요일은 0=일 … 6=토 (Date.getDay()와 같음), 시각은 "HH:MM" 24시간제.
 * - 기상 시각 · 버스 · 도보는 다루지 않는다 (확장 프로그램 범위 밖).
 * - 웹 오늘 화면(today.js)의 같은 판단과 나중에 하나로 합칠 대상이다.
 *
 * 브라우저: <script src="js/schedule.js"> → 전역 WakeSchedule
 * Node:     require("./js/schedule.js")
 */
(function (root) {
  "use strict";

  var DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
  var TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

  // ---------- 시각 변환 · 표시 ----------

  // "HH:MM" → 그날 0시 기준 분. 형식이 틀리면 NaN
  function toMin(hhmm) {
    var m = TIME_RE.exec(hhmm);
    if (!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // 분 → "HH:MM"
  function fmtHM(min) {
    return pad(Math.floor(min / 60)) + ":" + pad(min % 60);
  }

  // 초 → "HH:MM:SS" (음수는 0으로)
  function fmtHMS(sec) {
    sec = Math.max(0, Math.floor(sec));
    return pad(Math.floor(sec / 3600)) + ":" + pad(Math.floor((sec % 3600) / 60)) + ":" + pad(sec % 60);
  }

  // Date → 그날 0시 기준 초
  function secOfDay(date) {
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  }

  // ---------- 검증 ----------

  // 문제가 없으면 null, 있으면 사람이 읽을 이유 문자열
  function validateProfile(p) {
    if (!p || typeof p !== "object") return "시간표 데이터 형식이 아니에요";
    if (p.version !== 1) return "지원하지 않는 데이터 버전이에요 — 웹에서 다시 저장해 주세요";
    if (!Array.isArray(p.classes)) return "수업 목록(classes)이 없어요";
    for (var i = 0; i < p.classes.length; i++) {
      var c = p.classes[i];
      var label = (i + 1) + "번째 수업";
      if (!c || typeof c !== "object") return label + " 형식이 잘못됐어요";
      if (typeof c.name !== "string" || !c.name.trim()) return label + "의 과목명이 없어요";
      label = "'" + c.name + "'";
      if (typeof c.day !== "number" || c.day % 1 !== 0 || c.day < 0 || c.day > 6) return label + "의 요일 값이 잘못됐어요";
      var s = toMin(c.start), e = toMin(c.end);
      if (isNaN(s) || isNaN(e)) return label + "의 시각이 HH:MM 형식이 아니에요";
      if (s >= e) return label + "의 시작 시각이 종료 시각보다 늦어요";
    }
    return null;
  }

  // ---------- 요일별 수업 ----------

  // 그 요일 수업을 시작 시각 순으로. startMin · endMin을 붙인 사본을 돌려준다
  function classesOn(profile, day) {
    var list = [];
    var src = (profile && profile.classes) || [];
    for (var i = 0; i < src.length; i++) {
      var c = src[i];
      if (c.day !== day) continue;
      list.push({
        id: c.id, name: c.name, room: c.room || "", day: c.day,
        start: c.start, end: c.end,
        startMin: toMin(c.start), endMin: toMin(c.end)
      });
    }
    list.sort(function (a, b) { return a.startMin - b.startMin || a.endMin - b.endMin; });
    return list;
  }

  // 오늘 이후(1~7일 뒤) 첫 수업이 있는 날. 수업이 하나도 없으면 null
  function findNextClassDay(profile, now) {
    var today = now.getDay();
    for (var offset = 1; offset <= 7; offset++) {
      var day = (today + offset) % 7;
      var list = classesOn(profile, day);
      if (list.length) {
        var label = offset === 1 ? "내일"
          : offset === 7 ? "다음 주 " + DAY_NAMES[day] + "요일"
          : DAY_NAMES[day] + "요일";
        return { offset: offset, day: day, label: label, first: list[0] };
      }
    }
    return null;
  }

  // ---------- 오늘 상태 ----------
  //
  // state
  //   empty   : 등록된 수업이 하나도 없음
  //   noClass : 오늘 수업 없음            → upcoming
  //   before  : 오늘 첫 수업 전           → next, secToNext
  //   inClass : 수업 중 (start ≤ now < end) → current, secLeftInCurrent, minLeftInCurrent, next(있으면)
  //   gap     : 공강 (끝난 수업 있고 다음 수업 남음) → next, secToNext
  //   done    : 오늘 수업 모두 끝          → upcoming
  function getTodayStatus(profile, now) {
    var nowSec = secOfDay(now);
    var today = classesOn(profile, now.getDay());
    var res = {
      state: null, day: now.getDay(), today: today,
      current: null, next: null, remaining: [],
      secToNext: null, secLeftInCurrent: null, minLeftInCurrent: null,
      upcoming: null
    };

    if (!profile || !profile.classes || profile.classes.length === 0) {
      res.state = "empty";
      return res;
    }

    var ended = 0;
    for (var i = 0; i < today.length; i++) {
      var c = today[i];
      var s = c.startMin * 60, e = c.endMin * 60;
      if (e <= nowSec) { ended++; continue; }          // 종료 시각 = 끝난 것
      res.remaining.push(c);
      if (s <= nowSec) { if (!res.current) res.current = c; }  // 시작 시각 = 수업 중
      else if (!res.next) res.next = c;
    }

    if (res.next) res.secToNext = res.next.startMin * 60 - nowSec;
    if (res.current) {
      res.secLeftInCurrent = res.current.endMin * 60 - nowSec;
      res.minLeftInCurrent = Math.ceil(res.secLeftInCurrent / 60);
    }

    if (today.length === 0) res.state = "noClass";
    else if (res.current) res.state = "inClass";
    else if (res.next) res.state = ended > 0 ? "gap" : "before";
    else res.state = "done";

    if (res.state === "noClass" || res.state === "done") res.upcoming = findNextClassDay(profile, now);
    return res;
  }

  // ---------- 수업 N분 전 알림 ----------
  //
  // 아직 시작하지 않았고 알리지 않은 첫 수업 (오늘 포함 0~7일 뒤, 시작 시각 순)
  // → { cls, startAt, notifyAt, key, late }  (startAt · notifyAt은 ms 타임스탬프)
  //   late = false : 알림 시각(수업 시작 − leadMin)이 아직 안 옴 → 그 시각에 예약
  //   late = true  : 알림 시각은 지났지만 수업 시작 전 (예: 수업 7분 전에 크롬을 켬)
  //                  → 바로 1회 알림 ("7분 뒤 …"). 대시보드 배너 규칙(plan.md A-3)과 같다
  // 이미 시작한 수업(시작 시각 = now 포함)은 건너뛴다.
  // key = "YYYY-MM-DD|수업id|시작". notifiedKeys(배열, 생략 가능)에 든 수업은 이미 알린 것이라 건너뛴다.
  function findNextReminder(profile, now, leadMin, notifiedKeys) {
    var nowMs = now.getTime();
    var done = Array.isArray(notifiedKeys) ? notifiedKeys : [];
    for (var offset = 0; offset <= 7; offset++) {
      var base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      var list = classesOn(profile, base.getDay());
      var ymd = base.getFullYear() + "-" + pad(base.getMonth() + 1) + "-" + pad(base.getDate());
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var startAt = new Date(base.getFullYear(), base.getMonth(), base.getDate(),
          Math.floor(c.startMin / 60), c.startMin % 60).getTime();
        if (startAt <= nowMs) continue;
        var key = ymd + "|" + c.id + "|" + c.start;
        if (done.indexOf(key) >= 0) continue;
        var notifyAt = startAt - leadMin * 60000;
        return { cls: c, startAt: startAt, notifyAt: notifyAt, key: key, late: notifyAt <= nowMs };
      }
    }
    return null;
  }

  // ---------- 미니 시간표 ----------
  //
  // 월~금은 항상, 토 · 일은 수업이 있을 때만 (주간 화면과 같은 규칙, 일요일은 맨 뒤)
  // 시간 범위는 가장 이른 시작 ~ 가장 늦은 종료를 정시 단위로. 수업이 없으면 9~18시
  function buildWeekGrid(profile, todayDay) {
    var days = [1, 2, 3, 4, 5];
    if (classesOn(profile, 6).length) days.push(6);
    if (classesOn(profile, 0).length) days.push(0);

    var minStart = Infinity, maxEnd = -Infinity;
    var src = (profile && profile.classes) || [];
    for (var i = 0; i < src.length; i++) {
      if (days.indexOf(src[i].day) < 0) continue;
      minStart = Math.min(minStart, toMin(src[i].start));
      maxEnd = Math.max(maxEnd, toMin(src[i].end));
    }
    var startHour = isFinite(minStart) ? Math.floor(minStart / 60) : 9;
    var endHour = isFinite(maxEnd) ? Math.ceil(maxEnd / 60) : 18;
    if (endHour <= startHour) endHour = startHour + 1;
    var span = (endHour - startHour) * 60;

    var hours = [];
    for (var h = startHour; h <= endHour; h++) hours.push(h);

    var columns = days.map(function (d) {
      return {
        day: d,
        name: DAY_NAMES[d],
        isToday: d === todayDay,
        blocks: classesOn(profile, d).map(function (c) {
          return {
            cls: c,
            topPct: (c.startMin - startHour * 60) / span * 100,
            heightPct: (c.endMin - c.startMin) / span * 100
          };
        })
      };
    });

    return { days: days, startHour: startHour, endHour: endHour, hours: hours, columns: columns };
  }

  var api = {
    DAY_NAMES: DAY_NAMES,
    toMin: toMin,
    fmtHM: fmtHM,
    fmtHMS: fmtHMS,
    validateProfile: validateProfile,
    classesOn: classesOn,
    findNextClassDay: findNextClassDay,
    getTodayStatus: getTodayStatus,
    findNextReminder: findNextReminder,
    buildWeekGrid: buildWeekGrid
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WakeSchedule = api;
})(this);
