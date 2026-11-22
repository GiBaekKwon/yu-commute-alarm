/*
 * classes.js — 수업 판단 (순수 함수, DOM · 저장소 접근 없음)  plan.md A-1 · A-3
 * time.js · calc.js 를 먼저 불러와야 한다.
 *
 * "지금"은 Date 로 받고, 그날 0시 기준 초(nowSec)로 바꿔 비교한다. (한국 시간, 서머타임 없음)
 *
 * 10분 전 알림 규칙 (CLAUDE.md 7번)
 *   - 오늘 수업 중 0 < 시작 − 지금 ≤ 600초 인 가장 이른 수업
 *   - 이미 시작한 수업(시작 ≤ 지금)은 대상 아님
 *   - 같은 수업은 당일 한 번만: 이미 보여 준 키(alertKey)는 건너뜀
 */
(function (root) {
  'use strict';

  var T = root.WakeTime || (typeof require !== 'undefined' ? require('./time.js') : null);
  var C = root.WakeCalc || (typeof require !== 'undefined' ? require('./calc.js') : null);

  var ALERT_SEC = 10 * 60;
  var DAY_SEC = 24 * 60 * 60;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Date → "YYYY-MM-DD" (기기 시간대 기준) */
  function dateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  /** Date → 그날 0시 기준 초 */
  function secOfDay(date) {
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  }

  function startSec(c) { return T.toMin(c.start) * 60; }
  function endSec(c) { return T.toMin(c.end) * 60; }

  /** 오늘 수업 (시작 순) */
  function todays(classes, date) {
    return C.classesOfDay(classes, date.getDay());
  }

  /** 오늘 아직 끝나지 않은 수업 (수업 중 포함) */
  function remainingToday(classes, date) {
    var now = secOfDay(date);
    return todays(classes, date).filter(function (c) { return endSec(c) > now; });
  }

  /** 지금 수업 중인 수업 (없으면 null) */
  function currentClass(classes, date) {
    var now = secOfDay(date);
    return todays(classes, date).filter(function (c) { return startSec(c) <= now && now < endSec(c); })[0] || null;
  }

  /**
   * 다음에 시작할 수업 (오늘 포함 최대 7일 뒤까지)
   * → { cls, offset(0=오늘, 1=내일…), day, secondsLeft } 또는 null(수업이 하나도 없음)
   */
  function nextClass(classes, date) {
    var now = secOfDay(date);
    var today = date.getDay();
    for (var offset = 0; offset <= 7; offset++) {
      var day = (today + offset) % 7;
      var list = C.classesOfDay(classes, day);
      for (var i = 0; i < list.length; i++) {
        var left = offset * DAY_SEC + startSec(list[i]) - now;
        if (left > 0) return { cls: list[i], offset: offset, day: day, secondsLeft: left };
      }
    }
    return null;
  }

  /** 알림 중복 방지 키 (그날 기록 안에서 쓰임) */
  function alertKey(c, prefix) {
    return (prefix || '') + c.id + '|' + c.start;
  }

  /**
   * 지금 띄울 10분 전 알림 → { cls, key, secondsLeft } 또는 null
   * shownKeys: 오늘 이미 보여 준 키 배열
   */
  function alertTarget(classes, date, shownKeys, prefix) {
    var now = secOfDay(date);
    var shown = shownKeys || [];
    var list = todays(classes, date);
    for (var i = 0; i < list.length; i++) {
      var left = startSec(list[i]) - now;
      if (left > 0 && left <= ALERT_SEC) {
        var key = alertKey(list[i], prefix);
        if (shown.indexOf(key) < 0) return { cls: list[i], key: key, secondsLeft: left };
      }
    }
    return null;
  }

  /** 알림 기록을 오늘 것으로 맞춤: 날짜가 다르면 비운다 → { date, keys } */
  function alertedForToday(record, date) {
    var today = dateKey(date);
    if (!record || record.date !== today || !Array.isArray(record.keys)) return { date: today, keys: [] };
    return { date: today, keys: record.keys.slice() };
  }

  /** 남은 초 → 화면 표시 ("8분 40초", "45초") */
  function shortLeft(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m > 0 ? m + '분 ' + s + '초' : s + '초';
  }

  /** 카운트다운: 하루 넘으면 "N일 HH:MM:SS" */
  function countdownLong(sec) {
    sec = Math.max(0, Math.floor(sec));
    var d = Math.floor(sec / DAY_SEC);
    return (d > 0 ? d + '일 ' : '') + T.countdown(sec - d * DAY_SEC);
  }

  var api = {
    ALERT_SEC: ALERT_SEC,
    dateKey: dateKey,
    secOfDay: secOfDay,
    remainingToday: remainingToday,
    currentClass: currentClass,
    nextClass: nextClass,
    alertKey: alertKey,
    alertTarget: alertTarget,
    alertedForToday: alertedForToday,
    shortLeft: shortLeft,
    countdownLong: countdownLong
  };

  root.WakeClasses = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
