/*
 * commute.js — 통학 시간 계산 화면용 판단 (순수 함수, DOM · 저장소 접근 없음)  plan.md A-1 · A-1-2
 * time.js · calc.js 를 먼저 불러와야 한다.
 *
 * 11/21 기획: 출발지 · 도착지 · 준비 시간 · 여유 시간 → 이동 시간은 길찾기 API(연결 예정)로 계산
 *   → 총 소요 = 준비 + 이동 + 여유 → 요일별 첫 수업 기준 출발 · 기상 시각 (팀원이 단축어 알람으로 등록)
 * API 연결 전 · 실패 시: 대구 2호선 시각표(data/subway/line2.json)로 역 → 역 탑승 시간, 그것도 안 되면 직접 입력.
 */
(function (root) {
  'use strict';

  var T = root.WakeTime || (typeof require !== 'undefined' ? require('./time.js') : null);
  var C = root.WakeCalc || (typeof require !== 'undefined' ? require('./calc.js') : null);

  var DAY_NAME = ['일', '월', '화', '수', '목', '금', '토'];
  var ORDER = [1, 2, 3, 4, 5, 6, 0];

  function num(v) { return v == null || v === '' ? 0 : Number(v); }

  /** 역 이름 정리: 공백 · 끝의 "역" 제거 ("반월당 역" → "반월당") */
  function normStation(name) {
    return String(name == null ? '' : name).replace(/\s+/g, '').replace(/역$/, '');
  }

  /**
   * 지하철 시각표로 이동 시간 → { minutes(올림, 1 이상), from, to } 또는 null
   * data: data/subway/line2.json. 두 역이 모두 그 노선에 있어야 한다. 열차 탑승 시간만 (도보 · 대기 제외).
   * 도착지를 비우면 data.to(영남대)
   */
  function subwayMinutes(data, from, to) {
    if (!data || !Array.isArray(data.stations)) return null;
    var f = normStation(from), t = normStation(to) || data.to;
    var map = {};
    data.stations.forEach(function (s) { map[s.name] = s.minutes; });
    if (!f || !Object.prototype.hasOwnProperty.call(map, f) || !Object.prototype.hasOwnProperty.call(map, t) || f === t) return null;
    return { minutes: Math.max(1, Math.ceil(Math.abs(map[f] - map[t]))), from: f, to: t };
  }

  /** 분 → "1시간 27분" · "45분" · "2시간" */
  function duration(min) {
    min = Math.max(0, Math.round(num(min)));
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + '분';
    return h + '시간' + (m ? ' ' + m + '분' : '');
  }

  /** 총 소요 시간 나눔 → { prep, travel, buffer, total } */
  function breakdown(commute) {
    var b = { prep: num(commute.prepMin), travel: num(commute.travelMin), buffer: num(commute.bufferMin) };
    b.total = b.prep + b.travel + b.buffer;
    return b;
  }

  function hasPlan(r) { return !!r && (r.status === 'ok' || r.status === 'late'); }

  /** 요일별 표 (월 → 일, 수업 있는 날만) → [{ day, name, first, departure, wake, status }] */
  function planRows(week) {
    return ORDER.filter(function (d) { return hasPlan(week[d]); }).map(function (d) {
      var r = week[d];
      return { day: d, name: DAY_NAME[d], first: r.firstClass.start, departure: T.label(r.departure), wake: T.label(r.wake), status: r.status };
    });
  }

  /**
   * 대시보드 통학 띠 상태 (week: C.calcWeek 결과, route: 버스 시간표 모드일 때만, now: Date)
   *   { kind: 'before', day, secondsLeft }   오늘 첫 수업의 출발 시각 전 → 출발까지 카운트다운
   *   { kind: 'missed', day, check }         출발 시각은 지났고 첫 수업 전 (check = C.checkNow 결과)
   *   { kind: 'next', day, offset }          오늘 첫 수업이 시작했거나 오늘 수업 없음 → 다음 수업일 기상 · 출발
   *   { kind: 'none' }                       일주일 안에 수업 없음
   */
  function stripState(week, commute, route, now) {
    var nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    var today = now.getDay();
    var r = week[today];
    if (hasPlan(r)) {
      if (nowSec < r.departure * 60) return { kind: 'before', day: r, secondsLeft: r.departure * 60 - nowSec };
      if (nowSec < r.classStart * 60) {
        var check = C.isTravelMode(commute) || route ? C.checkNow(r, commute, route, Math.floor(nowSec / 60)) : { status: 'none' };
        return { kind: 'missed', day: r, check: check };
      }
    }
    for (var off = 1; off <= 7; off++) {
      var d = week[(today + off) % 7];
      if (hasPlan(d)) return { kind: 'next', day: d, offset: off };
    }
    return { kind: 'none' };
  }

  /** 단축어 · 알람 등록용 글 (팀원이 요일별 알람을 맞출 때 복사해 씀) */
  function shortcutText(week, commute) {
    var lines = ['[통학 알리미] 요일별 기상 시각'];
    if (C.isTravelMode(commute)) {
      var b = breakdown(commute);
      lines.push('총 소요 ' + duration(b.total) + ' (준비 ' + b.prep + '분 · 이동 ' + b.travel + '분 · 여유 ' + b.buffer + '분)');
    }
    planRows(week).forEach(function (row) {
      lines.push(row.name + ' 첫 수업 ' + row.first + ' → 출발 ' + row.departure + ' → 기상 ' + row.wake);
    });
    return lines.join('\n');
  }

  /**
   * 아이폰 단축어 "통학알람" 입력용 요일별 알람 (수업 있는 날만)
   * → { alarms: { "1": "07:20", … }, moved: [{ day, to, time }], skipped: [{ day, to, time }] }
   *   키 = 알람이 울릴 요일(0=일 … 6=토), 값 = "HH:MM"
   *   기상이 자정 전으로 넘어가면(wake < 0) 전날 요일 알람으로 옮긴다 → moved
   *   옮긴 알람이 그 요일 자기 알람과 겹치면 넣지 않는다 → skipped (화면에서 직접 맞추라고 안내)
   * 단축어는 레이블 "통학"이 든 알람을 모두 지우고 이 값으로 다시 만든다 (docs/iphone-shortcut.md)
   */
  function shortcutAlarms(week) {
    var res = { alarms: {}, moved: [], skipped: [] };
    var own = [], shifted = [];
    for (var d = 0; d < 7; d++) {
      if (!hasPlan(week[d])) continue;
      var c = T.toClock(week[d].wake);
      var to = (d + c.dayOffset + 7) % 7;
      (to === d ? own : shifted).push({ day: d, to: to, time: c.text });
    }
    own.forEach(function (a) { res.alarms[a.to] = a.time; });
    shifted.forEach(function (a) {
      if (Object.prototype.hasOwnProperty.call(res.alarms, a.to)) res.skipped.push(a);
      else { res.alarms[a.to] = a.time; res.moved.push(a); }
    });
    return res;
  }

  /** 단축어 실행 주소 (아이폰에서 누르거나 QR로 스캔) */
  function shortcutUrl(alarms, name) {
    var keys = Object.keys(alarms).sort();
    var body = '{' + keys.map(function (k) { return '"' + k + '":"' + alarms[k] + '"'; }).join(',') + '}';
    return 'shortcuts://run-shortcut?name=' + encodeURIComponent(name || '통학알람') +
      '&input=text&text=' + encodeURIComponent(body);
  }

  var api = {
    normStation: normStation,
    subwayMinutes: subwayMinutes,
    duration: duration,
    breakdown: breakdown,
    planRows: planRows,
    stripState: stripState,
    shortcutText: shortcutText,
    shortcutAlarms: shortcutAlarms,
    shortcutUrl: shortcutUrl
  };

  root.WakeCommute = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
