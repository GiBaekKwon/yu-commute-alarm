/*
 * calc.js — 기상 시각 계산 (순수 함수, DOM 접근 없음)
 * time.js 를 먼저 불러와야 한다.
 *
 * 규칙 (plan.md 3장)
 *   도착 목표 = 그날 첫 수업 시작 − 하차 후 강의실 도보 − 여유 시간
 *   탑승 한계 = 도착 목표 − 버스 소요 시간
 *   탈 버스   = 그날 요일 유형(평일/토/일) 시각 중 탑승 한계 이하인 가장 늦은 버스
 *   출발 시각 = 탈 버스 − 집→정류장 도보
 *   기상 시각 = 출발 시각 − 준비 시간
 *
 * 11/21 추가 — 이동 시간 모드 (commute 에 travelMin 이 있으면, route 는 쓰지 않음)
 *   출발지 → 도착지 이동 시간(travelMin)은 길찾기 API · 지하철 시각표 · 직접 입력으로 정한다.
 *   출발 시각 = 그날 첫 수업 시작 − 여유 시간 − 이동 시간
 *   기상 시각 = 출발 시각 − 준비 시간          (총 소요 = 준비 + 이동 + 여유)
 *
 * 입력 형식
 *   classes: [{ id, name, day(0=일…6=토), start:"HH:MM", end:"HH:MM", room }]
 *   commute: { prepMin, walkToStopMin, walkToRoomMin, bufferMin }   ← 버스 시간표 모드
 *            { prepMin, travelMin, bufferMin }                        ← 이동 시간 모드
 *   route:   { rideMin, times: { weekday:[], saturday:[], sunday:[] } } (이동 시간 모드는 null 가능)
 *
 * 계산 규칙을 바꾸면 test.html 케이스도 함께 고친다 (CLAUDE.md 6번).
 */
(function (root) {
  'use strict';

  var T = root.WakeTime || (typeof require !== 'undefined' ? require('./time.js') : null);

  var COMMUTE_FIELDS = ['prepMin', 'walkToStopMin', 'walkToRoomMin', 'bufferMin'];
  var TRAVEL_FIELDS = ['prepMin', 'travelMin', 'bufferMin'];

  /** 이동 시간 모드인지 (travelMin 필드가 있으면) */
  function isTravelMode(commute) {
    return !!commute && Object.prototype.hasOwnProperty.call(commute, 'travelMin');
  }

  /** 총 소요 시간(분) = 준비 + 이동 + 여유 (이동 시간 모드) */
  function totalMin(commute) {
    return num(commute.prepMin) + num(commute.travelMin) + num(commute.bufferMin);
  }
  var DAY_TYPES = ['weekday', 'saturday', 'sunday'];

  /** 요일(0=일…6=토) → 버스 시간표 유형 */
  function dayType(day) {
    if (day === 0) return 'sunday';
    if (day === 6) return 'saturday';
    return 'weekday';
  }

  /** 그 요일 수업을 시작 시각 순으로 */
  function classesOfDay(classes, day) {
    return (classes || [])
      .filter(function (c) { return c.day === day; })
      .slice()
      .sort(function (a, b) { return T.toMin(a.start) - T.toMin(b.start); });
  }

  /** 그 요일 유형의 버스 시각(분) 오름차순 */
  function busTimes(route, day) {
    var list = (route && route.times && route.times[dayType(day)]) || [];
    return list.map(T.toMin).sort(function (a, b) { return a - b; });
  }

  /** limit 이하 가장 늦은 버스(분). 없으면 null */
  function latestBusAtOrBefore(times, limit) {
    var found = null;
    for (var i = 0; i < times.length; i++) {
      if (times[i] <= limit) found = times[i];
    }
    return found;
  }

  /** from 이상 가장 이른 버스(분). 없으면 null */
  function firstBusAtOrAfter(times, from) {
    for (var i = 0; i < times.length; i++) {
      if (times[i] >= from) return times[i];
    }
    return null;
  }

  function num(v) {
    return v == null || v === '' ? 0 : Number(v);
  }

  /**
   * 하루 계산
   * 반환 status
   *   'no-class' : 그 요일 수업 없음 → 기상 시각 없음
   *   'no-bus'   : 그 요일 유형에 버스가 하나도 없음
   *   'ok'       : 제시간 버스 있음
   *   'late'     : 탑승 한계 이하 버스가 없어 첫차 기준, lateMin 만큼 지각 예상
   * 시각 값은 모두 0시 기준 분 (음수 = 전날)
   */
  function calcDay(classes, commute, route, day) {
    var todays = classesOfDay(classes, day);
    var base = { day: day, dayType: dayType(day), classes: todays };

    if (todays.length === 0) {
      base.status = 'no-class';
      return base;
    }

    var first = todays[0];                    // 공강이 있어도 첫 수업만 사용
    var classStart = T.toMin(first.start);
    if (isTravelMode(commute)) {              // 이동 시간 모드: 버스 시각표 없이 바로 거꾸로 계산
      base.firstClass = first;
      base.classStart = classStart;
      base.arriveTarget = classStart - num(commute.bufferMin);
      base.departure = base.arriveTarget - num(commute.travelMin);
      base.wake = base.departure - num(commute.prepMin);
      base.status = 'ok';
      base.lateMin = 0;
      return base;
    }
    var walkToRoom = num(commute.walkToRoomMin);
    var buffer = num(commute.bufferMin);
    var walkToStop = num(commute.walkToStopMin);
    var prep = num(commute.prepMin);
    var ride = num(route.rideMin);

    var arriveTarget = classStart - walkToRoom - buffer;
    var boardLimit = arriveTarget - ride;
    var times = busTimes(route, day);

    base.firstClass = first;
    base.classStart = classStart;
    base.arriveTarget = arriveTarget;
    base.boardLimit = boardLimit;

    if (times.length === 0) {
      base.status = 'no-bus';
      return base;
    }

    var bus = latestBusAtOrBefore(times, boardLimit);
    var lateMin = 0;
    if (bus === null) {
      bus = times[0];                          // 첫차 기준
      lateMin = bus + ride + walkToRoom - classStart;
    }

    base.status = lateMin > 0 ? 'late' : 'ok';
    base.bus = bus;
    base.lateMin = Math.max(0, lateMin);
    base.departure = bus - walkToStop;
    base.wake = base.departure - prep;
    return base;
  }

  /** 일~토 7일 계산 결과 배열 (index = 요일) */
  function calcWeek(classes, commute, route) {
    var out = [];
    for (var d = 0; d < 7; d++) out.push(calcDay(classes, commute, route, d));
    return out;
  }

  /**
   * 오늘 화면: 지금 시각 기준으로 버스를 놓쳤는지
   * now 가 출발 시각을 지났으면 놓친 것으로 보고,
   * 지금 집을 나서면 탈 수 있는 버스(now + 집→정류장 도보 이후 첫 버스)를 찾는다.
   *   예상 지각 = (다음 버스 + 소요 + 강의실 도보) − 수업 시작   (plan.md 3장)
   * 반환 status
   *   'none'        : 계산할 버스가 없음 (수업 없음 · 버스 없음)
   *   'on-time'     : 아직 출발 전
   *   'missed'      : 놓침, nextBus · lateMin 있음 (lateMin 0 이면 지각 아님)
   *   'no-more-bus' : 놓쳤고 오늘 남은 버스 없음
   */
  function checkNow(dayResult, commute, route, now) {
    if (!dayResult || (dayResult.status !== 'ok' && dayResult.status !== 'late')) {
      return { status: 'none' };
    }
    if (now <= dayResult.departure) {
      return { status: 'on-time', bus: dayResult.bus, departure: dayResult.departure };
    }
    if (isTravelMode(commute)) {              // 지금 나서면: 도착 = 지금 + 이동 시간
      var arrival = now + num(commute.travelMin);
      return { status: 'missed', arrival: arrival, lateMin: Math.max(0, arrival - dayResult.classStart) };
    }
    var times = busTimes(route, dayResult.day);
    var next = firstBusAtOrAfter(times, now + num(commute.walkToStopMin));
    if (next === null) return { status: 'no-more-bus' };
    var late = next + num(route.rideMin) + num(commute.walkToRoomMin) - dayResult.classStart;
    return { status: 'missed', nextBus: next, lateMin: Math.max(0, late) };
  }

  /* ---------- 입력 검증 (등록 화면 · 데이터 검사용) ---------- */

  /** 수업 목록 검사 → 오류 배열 [{ id, field, msg }] (빈 배열이면 통과) */
  function validateClasses(classes) {
    var errors = [];
    (classes || []).forEach(function (c) {
      if (!(c.day >= 0 && c.day <= 6 && c.day % 1 === 0)) {
        errors.push({ id: c.id, field: 'day', msg: '요일을 골라 주세요' });
      }
      var s = T.toMin(c.start);
      var e = T.toMin(c.end);
      if (isNaN(s)) errors.push({ id: c.id, field: 'start', msg: '시작 시각을 HH:MM 으로 입력해 주세요' });
      if (isNaN(e)) errors.push({ id: c.id, field: 'end', msg: '종료 시각을 HH:MM 으로 입력해 주세요' });
      if (!isNaN(s) && !isNaN(e) && s >= e) {
        errors.push({ id: c.id, field: 'end', msg: '종료 시각이 시작 시각보다 늦어야 해요' });
      }
    });
    // 같은 요일 겹침
    for (var d = 0; d < 7; d++) {
      var list = classesOfDay(classes, d).filter(function (c) {
        return !isNaN(T.toMin(c.start)) && !isNaN(T.toMin(c.end));
      });
      for (var i = 1; i < list.length; i++) {
        if (T.toMin(list[i].start) < T.toMin(list[i - 1].end)) {
          errors.push({ id: list[i].id, field: 'start', msg: '같은 요일의 다른 수업과 시간이 겹쳐요' });
        }
      }
    }
    return errors;
  }

  /** 통학 값 검사 (bufferMin 은 비워도 0) */
  function validateCommute(commute) {
    var errors = [];
    (isTravelMode(commute) ? TRAVEL_FIELDS : COMMUTE_FIELDS).forEach(function (f) {
      var v = commute ? commute[f] : undefined;
      var empty = v == null || v === '';
      if (empty && f === 'bufferMin') return;
      var n = Number(v);
      if (f === 'travelMin' && (empty || !isFinite(n) || n < 1 || n % 1 !== 0)) {
        errors.push({ field: f, msg: '이동 시간은 1 이상의 정수(분)로 입력해 주세요' });
      } else if (empty || !isFinite(n) || n < 0 || n % 1 !== 0) {
        errors.push({ field: f, msg: '0 이상의 정수(분)로 입력해 주세요' });
      }
    });
    return errors;
  }

  /** 버스 노선 검사: 소요 시간, 시각 형식(00:00~23:59), 오름차순 */
  function validateRoute(route) {
    var errors = [];
    var r = Number(route && route.rideMin);
    if (!route || !isFinite(r) || r <= 0 || r % 1 !== 0) {
      errors.push({ field: 'rideMin', msg: '버스 소요 시간은 1 이상의 정수(분)' });
    }
    DAY_TYPES.forEach(function (t) {
      var list = (route && route.times && route.times[t]) || [];
      if (!Array.isArray(list)) {
        errors.push({ field: t, msg: '시각 목록은 배열이어야 해요' });
        return;
      }
      var prev = -1;
      list.forEach(function (hhmm) {
        var m = T.toMin(hhmm);
        if (isNaN(m)) {
          errors.push({ field: t, msg: '"' + hhmm + '" 은(는) 00:00~23:59 형식이 아니에요' });
        } else if (m <= prev) {
          errors.push({ field: t, msg: '"' + hhmm + '" 이(가) 오름차순이 아니거나 중복이에요' });
        } else {
          prev = m;
        }
      });
    });
    return errors;
  }

  var api = {
    dayType: dayType,
    classesOfDay: classesOfDay,
    busTimes: busTimes,
    calcDay: calcDay,
    calcWeek: calcWeek,
    checkNow: checkNow,
    isTravelMode: isTravelMode,
    totalMin: totalMin,
    validateClasses: validateClasses,
    validateCommute: validateCommute,
    validateRoute: validateRoute
  };

  root.WakeCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
