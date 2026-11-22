/*
 * time.js — 시각 변환 도우미 (DOM 접근 없음)
 *
 * 규칙 (CLAUDE.md · plan.md 2장)
 * - 시각은 "HH:MM" 24시간제 문자열, 00:00 ~ 23:59 만 허용
 * - 내부 계산은 "그날 0시 기준 분" (정수)
 * - 음수 분은 전날, 1440 이상은 다음날로 표시
 */
(function (root) {
  'use strict';

  var DAY_MIN = 24 * 60;
  var HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

  /** "HH:MM" → 0시 기준 분. 형식이 틀리면 NaN */
  function toMin(hhmm) {
    if (typeof hhmm !== 'string') return NaN;
    var m = HHMM.exec(hhmm);
    if (!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function isValidHHMM(hhmm) {
    return !isNaN(toMin(hhmm));
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /**
   * 0시 기준 분 → { text: "HH:MM", dayOffset }
   * dayOffset: -1 = 전날, 0 = 그날, +1 = 다음날
   */
  function toClock(min) {
    var dayOffset = Math.floor(min / DAY_MIN);
    var inDay = min - dayOffset * DAY_MIN;
    return {
      text: pad2(Math.floor(inDay / 60)) + ':' + pad2(inDay % 60),
      dayOffset: dayOffset
    };
  }

  /** 화면 표시용: 전날이면 "전날 23:40", 다음날이면 "다음날 00:10" */
  function label(min) {
    var c = toClock(min);
    if (c.dayOffset < 0) return '전날 ' + c.text;
    if (c.dayOffset > 0) return '다음날 ' + c.text;
    return c.text;
  }

  /** 카운트다운용: 초 → "HH:MM:SS" (음수는 00:00:00) */
  function countdown(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  /** Date → 그날 0시 기준 분 (초는 버림) */
  function nowMin(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  /**
   * 사람이 친 시각 → "HH:MM" (24시간제). 빈칸이면 "", 알아들을 수 없으면 null.
   * 11/21 버그 수정: 브라우저 시각 칸(type=time)은 한국어에서 오전/오후 칸이 따로 있어,
   *   오후였던 칸의 숫자만 10:07 로 고치면 22:07 로 저장됐다 → 글자 칸 + 이 함수로 바꿈.
   * 받는 형식: "10:07" · "9:5"(×, 분은 두 자리) · "1007" · "930" · "10시 7분" · "10시반" · "10시" · "10"
   *   "오전/오후 · AM/PM" 을 직접 쓴 경우만 12시간제로 바꾼다 (오후 3시 → 15:00, 오전 12시 → 00:00).
   *   쓰지 않으면 24시간제 그대로 (10:07 → 10:07, 22:07 → 22:07).
   */
  function parseClock(text) {
    var s = String(text == null ? '' : text).replace(/\s+/g, '');
    if (!s) return '';
    var ampm = null, m;
    if ((m = /^(오전|오후|am|pm)/i.exec(s))) { ampm = m[1]; s = s.slice(m[1].length); }
    else if ((m = /(am|pm)$/i.exec(s))) { ampm = m[1]; s = s.slice(0, -2); }
    var h, mi;
    if ((m = /^(\d{1,2})[:：.](\d{2})$/.exec(s))) { h = +m[1]; mi = +m[2]; }
    else if ((m = /^(\d{1,2})시(?:(\d{1,2})분?|(반))?$/.exec(s))) { h = +m[1]; mi = m[2] != null ? +m[2] : (m[3] ? 30 : 0); }
    else if ((m = /^(\d{1,2})$/.exec(s))) { h = +m[1]; mi = 0; }
    else if ((m = /^(\d{1,2})(\d{2})$/.exec(s))) { h = +m[1]; mi = +m[2]; }
    else return null;
    if (ampm) {
      if (h < 1 || h > 12) return null;                       // "오후 15시" 같은 섞인 표기는 거부
      h = h % 12 + (/오후|pm/i.test(ampm) ? 12 : 0);
    }
    if (h > 23 || mi > 59) return null;
    return pad2(h) + ':' + pad2(mi);
  }

  var api = {
    DAY_MIN: DAY_MIN,
    toMin: toMin,
    isValidHHMM: isValidHHMM,
    parseClock: parseClock,
    toClock: toClock,
    label: label,
    countdown: countdown,
    nowMin: nowMin
  };

  root.WakeTime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
