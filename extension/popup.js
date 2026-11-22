/*
 * popup.js — 팝업 화면 그리기 · 1초 갱신 · chrome.storage 캐시 · 서버 API 요청
 * 계산은 js/schedule.js(WakeSchedule)에 맡기고, 여기서는 화면과 데이터 출처만 다룬다.
 *
 * 데이터 출처
 *   - 예시: sample-profile.json ("예시 데이터로 보기")
 *   - 서버: GET {API_BASE}/profile/<동기화 코드>  (config.js, 대시보드 측 API)
 *   두 출처 모두 plan.md 2-1 형식 → 받은 뒤의 처리는 같다.
 *
 * 저장(chrome.storage.local)
 *   syncCode : 연결에 성공한 동기화 코드
 *   cache    : { profile, source: "api" | "sample", syncedAt }  → 팝업을 열면 즉시 표시, 서버 실패 시에도 표시
 *
 * 시각 지정(테스트 · 시연): popup.html?now=2026-11-23T10:40 을 탭으로 열면 그 시각부터 흐른다.
 */
(function () {
  "use strict";

  var S = window.WakeSchedule;
  var CFG = window.WAKEUP_CONFIG || {};
  var CODE_RE = /^[a-z0-9]{8}$/;
  var TIMEOUT_MS = 5000;
  var SAMPLE_URL = "sample-profile.json";

  var LEADS = [5, 10, 15];
  var hasChrome = !!(window.chrome && chrome.storage && chrome.alarms);

  var data = { profile: null, source: null, syncedAt: null };
  var reminder = { enabled: true, leadMin: 10 };   // 수업 N분 전 알림 설정 (background.js가 읽음)
  var pending = null;                               // background.js가 예약해 둔 다음 알림
  var syncCode = null;
  var syncState = "idle";      // idle | loading | ok | offline
  var syncError = "";
  var tab = "today";
  var timer = null;
  var lastListKey = "";
  var lastWeekKey = "";

  // ---------- 현재 시각 (?now= 지원) ----------
  var fixedNow = (function () {
    var q = new URLSearchParams(location.search).get("now");
    if (!q) return null;
    var d = new Date(q);
    return isNaN(d.getTime()) ? null : d;
  })();
  var openedAt = Date.now();
  function now() {
    return fixedNow ? new Date(fixedNow.getTime() + (Date.now() - openedAt)) : new Date();
  }

  // ---------- DOM 도우미 ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;   // 서버 데이터는 항상 textContent로 (innerHTML 금지)
    return e;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function when(ts) {
    var d = new Date(ts), t = new Date();
    return d.toDateString() === t.toDateString() ? hm(d) : (d.getMonth() + 1) + "/" + d.getDate() + " " + hm(d);
  }

  // ---------- 저장소 ----------
  // 확장 안에서는 chrome.storage.local, 일반 브라우저로 열면 메모리(화면 확인용)
  var store = (function () {
    if (window.chrome && chrome.storage && chrome.storage.local) {
      return {
        get: function (keys) { return chrome.storage.local.get(keys); },
        set: function (obj) { return chrome.storage.local.set(obj); },
        remove: function (keys) { return chrome.storage.local.remove(keys); }
      };
    }
    var mem = {};
    return {
      get: function (keys) {
        var o = {};
        keys.forEach(function (k) { if (k in mem) o[k] = mem[k]; });
        return Promise.resolve(o);
      },
      set: function (obj) { Object.keys(obj).forEach(function (k) { mem[k] = obj[k]; }); return Promise.resolve(); },
      remove: function (keys) { [].concat(keys).forEach(function (k) { delete mem[k]; }); return Promise.resolve(); }
    };
  })();

  // ---------- 데이터 불러오기 ----------
  function fetchJSON(url) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, { signal: ctrl.signal, cache: "no-store" })
      .then(function (res) {
        if (!res.ok) { var err = new Error("HTTP " + res.status); err.status = res.status; throw err; }
        return res.json();
      })
      .finally(function () { clearTimeout(t); });
  }

  // 받아서 형식 검사까지. mock과 API 모두 이 함수를 거친다
  function loadProfile(url) {
    return fetchJSON(url).then(function (p) {
      var why = S.validateProfile(p);
      if (why) { var e = new Error(why); e.invalid = true; throw e; }
      return p;
    });
  }

  function apiUrl(code) {
    return CFG.API_BASE.replace(/\/+$/, "") + "/profile/" + encodeURIComponent(code);
  }

  function errorText(err) {
    if (err && err.invalid) return err.message;
    if (err && err.status === 404) return "이 코드로 저장된 시간표가 없어요";
    if (err && err.status) return "서버 오류 (" + err.status + ")";
    if (err && err.name === "AbortError") return "서버 응답이 없어요 (" + TIMEOUT_MS / 1000 + "초)";
    return "서버에 연결할 수 없어요";
  }

  function saveData(profile, source) {
    data = { profile: profile, source: source, syncedAt: Date.now() };
    lastListKey = lastWeekKey = "";
    return store.set({ cache: data });
  }

  // 저장된 코드로 서버에서 다시 받기 (실패해도 캐시는 그대로 표시)
  function refresh() {
    if (!syncCode) return;
    if (!CFG.API_BASE) { syncState = "offline"; syncError = "서버 주소가 설정되지 않았어요 (config.js)"; renderSync(); return; }
    syncState = "loading";
    renderSync();
    loadProfile(apiUrl(syncCode))
      .then(function (p) { return saveData(p, "api"); })
      .then(function () { syncState = "ok"; syncError = ""; showMain(); })
      .catch(function (err) {
        syncState = "offline";
        syncError = errorText(err);
        if (data.profile) renderSync(); else showCode(syncError);
      });
  }

  // 코드 입력 → 서버에서 받기에 성공해야 코드를 저장
  function connect(code) {
    if (!CODE_RE.test(code)) { showMsg("영문 소문자 · 숫자 8자리로 입력해 주세요"); return; }
    if (!CFG.API_BASE) { showMsg("서버 주소가 아직 설정되지 않았어요. 지금은 예시 데이터만 볼 수 있어요"); return; }
    setBusy(true);
    loadProfile(apiUrl(code))
      .then(function (p) {
        syncCode = code;
        return Promise.all([store.set({ syncCode: code }), saveData(p, "api")]);
      })
      .then(function () { syncState = "ok"; syncError = ""; showMain(); })
      .catch(function (err) { showMsg(errorText(err)); })
      .finally(function () { setBusy(false); });
  }

  function loadSample() {
    loadProfile(SAMPLE_URL)
      .then(function (p) {
        syncCode = null;
        return Promise.all([store.remove("syncCode"), saveData(p, "sample")]);
      })
      .then(function () { syncState = "idle"; syncError = ""; showMain(); })
      .catch(function () { showMsg("예시 데이터를 불러오지 못했어요"); });
  }

  // ---------- 화면 전환 ----------
  function showCode(msg) {
    stopTimer();
    $("view-main").hidden = true;
    $("view-code").hidden = false;
    $("btn-cancel").hidden = !data.profile;
    $("btn-code").hidden = true;
    $("code-input").value = syncCode || "";
    showMsg(msg || "");
    renderSync();
    renderFooter();
    $("code-input").focus();
  }

  function showMain() {
    $("view-code").hidden = true;
    $("view-main").hidden = false;
    $("btn-code").hidden = false;
    renderSync();
    renderFooter();
    setTab(tab);
    startTimer();
  }

  function showMsg(text) {
    $("code-msg").textContent = text;
    $("code-msg").hidden = !text;
  }

  function setBusy(busy) {
    $("code-submit").disabled = busy;
    $("code-submit").textContent = busy ? "연결 중…" : "연결";
  }

  function setTab(name) {
    tab = name;
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute("data-tab") === name;
      tabs[i].classList.toggle("on", on);
      tabs[i].setAttribute("aria-selected", on ? "true" : "false");
    }
    $("tab-today").hidden = name !== "today";
    $("tab-week").hidden = name !== "week";
    lastListKey = lastWeekKey = "";
    render();
  }

  // ---------- 1초 갱신 (초 경계에 맞춰 실행 → 카운트다운이 건너뛰지 않음) ----------
  function tick() {
    render();
    timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  }
  function startTimer() { stopTimer(); tick(); }
  function stopTimer() { if (timer) clearTimeout(timer); timer = null; }

  // ---------- 그리기 ----------
  function render() {
    if (!data.profile) return;
    var n = now();
    if (tab === "today") renderToday(n);
    else renderWeek(n);
  }

  function classLine(c) {
    return c.name + " · " + c.start + (c.room ? " · " + c.room : "");
  }
  function upcomingLine(u) {
    return u ? "다음 수업: " + u.label + " " + u.first.start + " " + u.first.name : "";
  }

  function renderToday(n) {
    var st = S.getTodayStatus(data.profile, n);
    var label = "", big = "", sub = "", isText = false;

    if (st.state === "before" || st.state === "gap") {
      label = "다음 수업까지";
      big = S.fmtHMS(st.secToNext);
      sub = classLine(st.next);
    } else if (st.state === "inClass") {
      label = st.current.name + " 수업 중" + (st.current.room ? " · " + st.current.room : "");
      big = st.minLeftInCurrent + "분 남음";
      sub = st.next ? "다음 " + st.next.name + "까지 " + S.fmtHMS(st.secToNext) : "오늘 마지막 수업이에요";
    } else if (st.state === "done") {
      big = "오늘 수업 끝"; isText = true;
      sub = upcomingLine(st.upcoming);
    } else if (st.state === "noClass") {
      big = "오늘은 수업이 없어요"; isText = true;
      sub = upcomingLine(st.upcoming);
    } else {
      big = "등록된 수업이 없어요"; isText = true;
      sub = "웹 등록 화면에서 시간표를 입력해 주세요";
    }

    $("hero-label").textContent = label;
    $("hero-label").hidden = !label;
    $("hero-big").textContent = big;
    $("hero-big").classList.toggle("text", isText);
    $("hero-sub").textContent = sub;
    $("hero-sub").hidden = !sub;

    renderRemaining(st);
  }

  // 남은 수업 목록은 내용이 바뀔 때만 다시 그린다
  function renderRemaining(st) {
    var key = st.state + "|" + (st.current ? st.current.id : "") + "|" +
      st.remaining.map(function (c) { return c.id + "@" + c.start; }).join(",");
    if (key === lastListKey) return;
    lastListKey = key;

    var noToday = st.state === "noClass" || st.state === "empty";
    $("remaining").hidden = noToday;
    document.querySelector(".section-title").hidden = noToday;
    if (noToday) return;

    var ul = $("remaining");
    ul.textContent = "";
    if (!st.remaining.length) {
      ul.appendChild(el("li", "empty", "남은 수업이 없어요"));
      return;
    }
    st.remaining.forEach(function (c) {
      var isNow = c === st.current;
      var li = el("li", isNow ? "now" : "");
      li.appendChild(el("span", "time", c.start + "–" + c.end));
      li.appendChild(el("span", "name", c.name + (isNow ? " (수업 중)" : "")));
      if (c.room) li.appendChild(el("span", "room", c.room));
      ul.appendChild(li);
    });
  }

  // 미니 시간표는 요일이 바뀌거나 데이터가 바뀔 때만 다시 그린다
  function renderWeek(n) {
    var key = n.getDay() + "|" + data.syncedAt;
    if (key === lastWeekKey) return;
    lastWeekKey = key;

    var g = S.buildWeekGrid(data.profile, n.getDay());
    var hourPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour-height")) || 28;
    var bodyH = (g.endHour - g.startHour) * hourPx;
    var grid = $("grid");
    grid.textContent = "";

    // 시각 눈금 열
    var hoursCol = el("div", "hours");
    hoursCol.appendChild(el("div", "head", ""));
    var hoursBody = el("div", "body");
    hoursBody.style.height = bodyH + "px";
    g.hours.forEach(function (h, i) {
      var lab = el("span", "hour-label", String(h));
      lab.style.top = (i * hourPx) + "px";
      hoursBody.appendChild(lab);
    });
    hoursCol.appendChild(hoursBody);
    grid.appendChild(hoursCol);

    // 요일 열
    g.columns.forEach(function (col) {
      var c = el("div", "col" + (col.isToday ? " today" : ""));
      c.appendChild(el("div", "head", col.name));
      var body = el("div", "body");
      body.style.height = bodyH + "px";
      for (var i = 1; i < g.hours.length - 1; i++) {
        var line = el("div", "hour-line");
        line.style.top = (i * hourPx) + "px";
        body.appendChild(line);
      }
      col.blocks.forEach(function (b) {
        var blk = el("div", "block");
        blk.style.top = b.topPct + "%";
        blk.style.height = b.heightPct + "%";
        blk.appendChild(el("span", "b-name", b.cls.name));
        if (b.cls.room) blk.appendChild(el("span", "b-room", b.cls.room));
        blk.title = b.cls.name + "\n" + b.cls.start + "–" + b.cls.end + (b.cls.room ? "\n" + b.cls.room : "");
        body.appendChild(blk);
      });
      c.appendChild(body);
      grid.appendChild(c);
    });
  }

  function renderSync() {
    var chip = $("sync");
    var text = "", cls = "chip";
    if (data.source === "sample") {
      text = "예시 데이터";
    } else if (syncState === "loading") {
      text = "동기화 중…";
    } else if (data.profile && syncState === "ok") {
      text = "● " + when(data.syncedAt) + " 동기화"; cls += " ok";
    } else if (data.profile && syncState === "offline") {
      text = "오프라인 · " + when(data.syncedAt); cls += " warn";
    } else if (data.profile) {
      text = when(data.syncedAt) + " 저장본";
    }
    chip.className = cls;
    chip.textContent = text;
    chip.title = syncError;
    chip.hidden = !text;
  }

  function renderFooter() {
    var link = $("link-web");
    if (CFG.WEB_BASE) {
      link.href = CFG.WEB_BASE.replace(/\/?$/, "/");   // 대시보드 (설정은 대시보드 하단 탭에서)
      link.hidden = false;
    } else {
      link.hidden = true;
    }
    if (fixedNow) {
      document.querySelector(".bottom .note").textContent =
        "시각 지정: " + (fixedNow.getMonth() + 1) + "/" + fixedNow.getDate() + " " + hm(fixedNow);
    }
  }

  // ---------- 수업 전 알림 설정 ----------
  function normalizeReminder(r) {
    r = r || {};
    return { enabled: r.enabled !== false, leadMin: LEADS.indexOf(r.leadMin) >= 0 ? r.leadMin : 10 };
  }

  function dayLabel(ts) {
    var d = new Date(ts), t = new Date();
    var diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) -
      new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
    return diff === 0 ? "오늘" : diff === 1 ? "내일" : S.DAY_NAMES[d.getDay()] + "요일";
  }

  function renderReminder() {
    $("rm-enabled").checked = reminder.enabled;
    $("rm-lead").value = String(reminder.leadMin);
    $("rm-lead").disabled = !reminder.enabled;
    var text;
    if (!hasChrome) text = "확장 프로그램 안에서만 동작해요";
    else if (!reminder.enabled) text = "알림 꺼짐";
    else if (pending) text = "다음 알림: " + dayLabel(pending.notifyAt) + " " + hm(new Date(pending.notifyAt)) + " · " + pending.name;
    else text = "예약된 알림 없음";
    $("rm-next").textContent = text;
    $("rm-next").title = text;
  }

  function saveReminder() {
    reminder = normalizeReminder({ enabled: $("rm-enabled").checked, leadMin: Number($("rm-lead").value) });
    renderReminder();
    store.set({ reminder: reminder });   // background.js가 storage 변경을 보고 다시 예약
  }

  function testReminder() {
    if (!hasChrome) return;
    chrome.alarms.create("test", { when: Date.now() + 60000 });
    $("rm-test").textContent = "1분 뒤 알림 예약됨 ✓";
    $("rm-test").disabled = true;
  }

  // ---------- 시작 ----------
  function bindEvents() {
    $("code-form").addEventListener("submit", function (e) {
      e.preventDefault();
      connect($("code-input").value.trim().toLowerCase());
    });
    $("btn-sample").addEventListener("click", loadSample);
    $("btn-cancel").addEventListener("click", function () { showMain(); });
    $("btn-code").addEventListener("click", function () { showCode(); });
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () { setTab(this.getAttribute("data-tab")); });
    }
    $("rm-enabled").addEventListener("change", saveReminder);
    $("rm-lead").addEventListener("change", saveReminder);
    $("rm-test").addEventListener("click", testReminder);
    // background.js가 다음 알림을 다시 예약하면 "다음 알림" 문구 갱신
    if (hasChrome) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === "local" && changes.pending) {
          pending = changes.pending.newValue || null;
          renderReminder();
        }
      });
    }
  }

  function init() {
    bindEvents();
    store.get(["syncCode", "cache", "reminder", "pending"]).then(function (saved) {
      reminder = normalizeReminder(saved.reminder);
      pending = saved.pending || null;
      renderReminder();
      syncCode = saved.syncCode || null;
      var c = saved.cache;
      if (c && c.profile && !S.validateProfile(c.profile)) data = c;
      if (data.profile) showMain(); else showCode();
      if (syncCode) refresh();
    });
  }

  init();
})();
