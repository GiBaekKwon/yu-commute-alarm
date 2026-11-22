/*
 * background.js — 수업 시작 N분 전 PC 알림 (MV3 서비스 워커, 팝업이 닫혀 있어도 동작)
 *
 * ※ 전날 밤 기상 알림(서버 notify.py → 폰 ntfy · Telegram, plan.md 3단계)과는 별개다.
 *   여기서는 기상 시각 · 버스를 다루지 않고 "수업 시작 시각"만 쓴다.
 *
 * 흐름
 *   schedule(): 캐시된 시간표에서 findNextReminder → chrome.alarms "reminder" 예약, 내용은 storage "pending"에 저장
 *               알림 시각이 이미 지났지만 수업 시작 전이면(크롬을 늦게 켬 등) 예약 없이 바로 알림 (대시보드 A-3과 같은 규칙)
 *   "reminder" 울림 → 수업이 아직 시작 전이고 처음 보내는 알림이면 표시 → 다음 알림 예약
 *   모든 예약 · 알림 작업은 run()으로 한 줄로 처리 → 이벤트가 겹쳐도 같은 수업에 두 번 알리지 않음
 *   "tick"(30분마다) → 서버에서 시간표 다시 받기(코드 연결 시) → 다시 예약 (절전 해제 · 시계 변경 대비)
 *   "test" → 팝업의 "테스트 알림 (1분 뒤)" 버튼
 *
 * storage.local
 *   reminder     : { enabled, leadMin }       팝업에서 설정 (기본 켜짐 · 10분)
 *   pending      : { key, name, room, start, startAt, notifyAt, leadMin }  예약된 알림 (팝업 "다음 알림" 표시용)
 *   notified     : 최근 보낸 알림 key 목록 (최대 NOTIFIED_MAX개, 중복 방지)
 */
importScripts("config.js", "js/schedule.js");

var S = self.WakeSchedule;
var CFG = self.WAKEUP_CONFIG || {};
var ALARM_REMINDER = "reminder";
var ALARM_TICK = "tick";
var ALARM_TEST = "test";
var TICK_MIN = 30;
var LEADS = [5, 10, 15];
var TIMEOUT_MS = 5000;
var NOTIFIED_MAX = 20;

// 작업을 한 줄로 세운다 (앞 작업이 실패해도 다음 작업은 실행)
var queue = Promise.resolve();
function run(task) {
  queue = queue.then(task).catch(function (e) { console.warn("[wakeup]", e); });
  return queue;
}

// 이미 알린 key 목록 (이전 버전의 lastNotified 한 개도 함께 본다)
function notifiedOf(s) {
  var list = Array.isArray(s.notified) ? s.notified.slice() : [];
  if (typeof s.lastNotified === "string" && list.indexOf(s.lastNotified) < 0) list.push(s.lastNotified);
  return list;
}

function settingsOf(s) {
  var r = s.reminder || {};
  return {
    enabled: r.enabled !== false,
    leadMin: LEADS.indexOf(r.leadMin) >= 0 ? r.leadMin : 10
  };
}

function classLine(p) {
  return p.start + (p.room ? " · " + p.room : "");
}

function notify(title, message) {
  chrome.notifications.create("wakeup-" + Date.now(), {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: title,
    message: message,
    priority: 2
  }, function () {});
}

function clearReminder() {
  return chrome.alarms.clear(ALARM_REMINDER).then(function () {
    return chrome.storage.local.remove("pending");
  });
}

// 다음 알림 예약
function schedule() {
  return chrome.storage.local.get(["cache", "reminder", "notified", "lastNotified"]).then(function (s) {
    var set = settingsOf(s);
    var profile = s.cache && s.cache.profile;
    if (!set.enabled || !profile || S.validateProfile(profile)) return clearReminder();

    var r = S.findNextReminder(profile, new Date(), set.leadMin, notifiedOf(s));
    if (!r) return clearReminder();

    return chrome.storage.local.set({
      pending: {
        key: r.key, name: r.cls.name, room: r.cls.room, start: r.cls.start,
        startAt: r.startAt, notifyAt: r.notifyAt, leadMin: set.leadMin
      }
    }).then(function () {
      // 늦게 켬: 수업 시작 전이니 지금 바로 알리고(그 안에서 다음 알림 예약), 아니면 알림 시각에 예약
      if (r.late) return chrome.alarms.clear(ALARM_REMINDER).then(fireReminder);
      chrome.alarms.create(ALARM_REMINDER, { when: r.notifyAt });
    });
  });
}

// 예약한 알림이 울렸을 때
function fireReminder() {
  return chrome.storage.local.get(["pending", "reminder", "notified", "lastNotified"]).then(function (s) {
    var p = s.pending;
    var now = Date.now();
    var done = notifiedOf(s);
    // 보내지 않는 경우: 알림 시각 전(1분 여유)에 울림 · 절전 등으로 늦게 울려 수업이 이미 시작함 · 같은 수업 두 번
    if (!p || !settingsOf(s).enabled) return;
    if (now < p.notifyAt - 60000 || now >= p.startAt || done.indexOf(p.key) >= 0) return;
    var mins = Math.max(1, Math.ceil((p.startAt - now) / 60000));
    notify(mins + "분 뒤 " + p.name, classLine(p));
    done.push(p.key);
    return chrome.storage.local.set({ notified: done.slice(-NOTIFIED_MAX) }).then(function () {
      return chrome.storage.local.remove("lastNotified");
    });
  }).then(schedule);
}

function fireTest() {
  return chrome.storage.local.get(["pending"]).then(function (s) {
    var p = s.pending;
    if (p) notify("[테스트] " + p.leadMin + "분 뒤 " + p.name, classLine(p) + " — 실제 알림은 이렇게 와요");
    else notify("[테스트] 수업 알림", "수업 시작 전에 이렇게 알려 드려요");
  });
}

// 코드로 연결된 경우 서버에서 시간표를 다시 받아 캐시 갱신 (실패는 조용히 무시, 캐시 유지)
function refreshFromServer() {
  return chrome.storage.local.get(["syncCode", "cache"]).then(function (s) {
    if (!s.syncCode || !CFG.API_BASE || !s.cache || s.cache.source !== "api") return;
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    var url = CFG.API_BASE.replace(/\/+$/, "") + "/profile/" + encodeURIComponent(s.syncCode);
    return fetch(url, { signal: ctrl.signal, cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (p) {
        if (S.validateProfile(p)) return;
        return chrome.storage.local.set({ cache: { profile: p, source: "api", syncedAt: Date.now() } });
      })
      .catch(function () {})
      .finally(function () { clearTimeout(t); });
  });
}

function setup() {
  chrome.alarms.create(ALARM_TICK, { periodInMinutes: TICK_MIN });
  return run(schedule);
}

// ---- 이벤트 (서비스 워커는 수시로 꺼졌다 켜지므로 최상위에서 바로 등록)
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === ALARM_REMINDER) run(fireReminder);
  else if (alarm.name === ALARM_TEST) fireTest();
  else if (alarm.name === ALARM_TICK) refreshFromServer().then(function () { return run(schedule); });
});

// 시간표(cache)나 알림 설정(reminder)이 바뀌면 다시 예약
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === "local" && (changes.cache || changes.reminder)) run(schedule);
});

// 알림을 누르면 닫고, 웹 주소가 설정돼 있으면 오늘 화면 열기
chrome.notifications.onClicked.addListener(function (id) {
  chrome.notifications.clear(id);
  if (CFG.WEB_BASE) chrome.tabs.create({ url: CFG.WEB_BASE.replace(/\/?$/, "/") });
});
