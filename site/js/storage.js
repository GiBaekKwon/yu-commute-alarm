/*
 * storage.js — 사용자 프로필 저장 · 불러오기 (1단계: localStorage)
 * time.js · calc.js 를 먼저 불러와야 한다.
 *
 * 형식: plan.md 2-1 (localStorage 키 "wakeup.v1")
 * 개인정보 금지 (CLAUDE.md 2번): 아래 허용 필드만 남기고 나머지는 저장 전에 버린다.
 *   주소 · 좌표 · 이름 · 학번 · 전화번호 같은 필드는 들어와도 저장되지 않는다.
 * 2단계 서버 동기화: 동기화 코드(영문 소문자 · 숫자 8자리, 키 "wakeup.sync")가 있으면
 *   저장할 때 서버(api/profile/<code>)에도 저장하고, 화면을 열 때 서버 것을 먼저 불러온다.
 *   서버가 안 되면 이 기기 저장본(localStorage)을 쓴다.
 */
(function (root) {
  'use strict';

  var T = root.WakeTime || (typeof require !== 'undefined' ? require('./time.js') : null);
  var C = root.WakeCalc || (typeof require !== 'undefined' ? require('./calc.js') : null);

  var KEY = 'wakeup.v1';
  var VERSION = 1;
  var SAMPLE_URL = 'data/sample-timetable.json';   // 상대 경로 (/wakeup/ 아래에서도 동작)
  var TEXT_MAX = 40;                                // 과목 · 강의실 글자 수 제한
  var DAY_TYPES = ['weekday', 'saturday', 'sunday'];

  function storageArea() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  function text(v) {
    return typeof v === 'string' ? v.trim().slice(0, TEXT_MAX) : '';
  }

  /** 숫자처럼 보이면 숫자로, 빈칸은 '' 그대로 (검증에서 걸러짐) */
  function numOrBlank(v) {
    if (v === '' || v == null) return '';
    var n = Number(v);
    return isFinite(n) ? n : v;
  }

  function emptyProfile() {
    return {
      version: VERSION,
      classes: [],
      commute: null,          // 통학 정보는 선택 (11/21 개편)
      notify: { enabled: false, channel: 'ntfy', topic: '', sendAt: '21:00' }
    };
  }

  /** 허용 필드만 남긴 새 객체를 돌려준다 (원본은 바꾸지 않음) */
  function sanitize(raw) {
    var p = emptyProfile();
    if (!raw || typeof raw !== 'object') return p;

    if (Array.isArray(raw.classes)) {
      p.classes = raw.classes.map(function (c, i) {
        c = c || {};
        return {
          id: typeof c.id === 'string' && c.id ? c.id.slice(0, 20) : 'c' + (i + 1),
          name: text(c.name),
          day: Number(c.day),
          start: typeof c.start === 'string' ? c.start : '',
          end: typeof c.end === 'string' ? c.end : '',
          room: text(c.room)
        };
      });
    }

    var rc = raw.commute;
    if (rc && typeof rc === 'object') p.commute = sanitizeCommute(rc);

    var rn = raw.notify || {};
    p.notify.enabled = rn.enabled === true;
    p.notify.channel = 'ntfy';                 // 3단계에서 채널 추가 시 확장
    p.notify.topic = typeof rn.topic === 'string' ? rn.topic.trim().slice(0, 64) : '';
    p.notify.sendAt = typeof rn.sendAt === 'string' ? rn.sendAt : '21:00';
    return p;
  }

  function sanitizeCommute(rc) {
    if (C.isTravelMode(rc)) {                  // 11/21 이동 시간 모드: 분 세 개만 (출발지 · 도착지는 저장하지 않음)
      return {
        prepMin: numOrBlank(rc.prepMin),
        travelMin: numOrBlank(rc.travelMin),
        bufferMin: rc.bufferMin === '' || rc.bufferMin == null ? 0 : numOrBlank(rc.bufferMin)
      };
    }
    var cm = {};
    cm.prepMin = numOrBlank(rc.prepMin);
    cm.walkToStopMin = numOrBlank(rc.walkToStopMin);
    cm.walkToRoomMin = numOrBlank(rc.walkToRoomMin);
    cm.bufferMin = rc.bufferMin === '' || rc.bufferMin == null ? 0 : numOrBlank(rc.bufferMin);
    cm.routeId = typeof rc.routeId === 'string' ? rc.routeId.slice(0, 40) : '';
    cm.customTimes = null;
    if (rc.customTimes && typeof rc.customTimes === 'object') {
      var ct = { rideMin: numOrBlank(rc.customTimes.rideMin) };
      DAY_TYPES.forEach(function (t) {
        var list = rc.customTimes[t];
        ct[t] = Array.isArray(list) ? list.filter(function (s) { return typeof s === 'string'; }) : [];
      });
      cm.customTimes = ct;
    }
    return cm;
  }

  /** 직접 입력 버스 시각 → calc.js 가 쓰는 노선 형식 */
  function customToRoute(ct) {
    return {
      id: 'custom', name: '직접 입력', rideMin: ct.rideMin,
      times: { weekday: ct.weekday || [], saturday: ct.saturday || [], sunday: ct.sunday || [] }
    };
  }

  /**
   * 프로필 검사 → 오류 배열 [{ scope, id?, field, msg }]
   * scope: 'classes' | 'commute' | 'route' | 'notify'
   */
  function validate(profile) {
    var errors = [];
    function add(scope, list) {
      list.forEach(function (e) { e.scope = scope; errors.push(e); });
    }
    add('classes', C.validateClasses(profile.classes));
    var cm = profile.commute;
    if (cm) {                                   // 통학 정보가 없으면(null) 통학 · 노선 검사 생략
      add('commute', C.validateCommute(cm));
      if (C.isTravelMode(cm)) {
        // 이동 시간 모드는 버스 노선 검사 없음
      } else if (cm.customTimes) {
        add('route', C.validateRoute(customToRoute(cm.customTimes)));
      } else if (!cm.routeId) {
        add('route', [{ field: 'routeId', msg: '노선을 고르거나 버스 시각을 직접 입력해 주세요' }]);
      }
    }

    // 서버(app.py)와 같은 기준: 알림을 꺼도 형식은 검사, 켜면 토픽 필수
    var n = profile.notify || {};
    if (!T.isValidHHMM(n.sendAt)) add('notify', [{ field: 'sendAt', msg: '알림 시각을 HH:MM 으로 입력해 주세요' }]);
    if (!/^[A-Za-z0-9_-]{0,64}$/.test(n.topic || '')) {
      add('notify', [{ field: 'topic', msg: '토픽은 영문 · 숫자 · _ · - 만, 64자까지 쓸 수 있어요' }]);
    } else if (n.enabled && !n.topic) {
      add('notify', [{ field: 'topic', msg: '알림을 받으려면 토픽 이름이 필요해요' }]);
    }
    return errors;
  }

  /** 저장된 프로필. 없거나 깨졌으면 null */
  function load() {
    var ls = storageArea();
    if (!ls) return null;
    try {
      var raw = ls.getItem(KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || obj.version !== VERSION) return null;
      return sanitize(obj);
    } catch (e) {
      return null;
    }
  }

  /** 검사 통과 시에만 저장 → { ok, errors, profile } */
  function save(profile) {
    var clean = sanitize(profile);
    var errors = validate(clean);
    if (errors.length) return { ok: false, errors: errors, profile: clean };
    var ls = storageArea();
    if (!ls) {
      return { ok: false, profile: clean,
        errors: [{ scope: 'storage', field: '', msg: '이 브라우저에서는 저장할 수 없어요 (비공개 모드 확인)' }] };
    }
    try {
      ls.setItem(KEY, JSON.stringify(clean));
    } catch (e) {
      return { ok: false, profile: clean, errors: [{ scope: 'storage', field: '', msg: '저장에 실패했어요' }] };
    }
    return { ok: true, errors: [], profile: clean };
  }

  function clear() {
    var ls = storageArea();
    if (ls) { try { ls.removeItem(KEY); } catch (e) { /* 무시 */ } }
  }

  /** 시연용 예시 불러오기 (저장은 하지 않음) → Promise<profile> */
  function loadSample() {
    return fetch(SAMPLE_URL, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('예시 파일을 불러오지 못했어요 (' + res.status + ')');
      return res.json();
    }).then(sanitize);
  }

  /* ---------- 2단계: 서버 동기화 (동기화 코드) ---------- */
  var SYNC_KEY = 'wakeup.sync';
  var API = 'api/profile/';                      // 상대 경로 → /wakeup/api/profile/
  var CODE_RE = /^[a-z0-9]{8}$/;
  var CODE_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';   // 헷갈리는 l · o · 0 · 1 제외
  var TIMEOUT_MS = 6000;

  function isValidCode(code) {
    return typeof code === 'string' && CODE_RE.test(code);
  }

  function getSyncCode() {
    var ls = storageArea();
    if (!ls) return null;
    try {
      var c = ls.getItem(SYNC_KEY);
      return isValidCode(c) ? c : null;
    } catch (e) { return null; }
  }

  function setSyncCode(code) {
    if (!isValidCode(code)) return false;
    var ls = storageArea();
    if (!ls) return false;
    try { ls.setItem(SYNC_KEY, code); return true; } catch (e) { return false; }
  }

  function clearSyncCode() {
    var ls = storageArea();
    if (ls) { try { ls.removeItem(SYNC_KEY); ls.removeItem(PENDING_KEY); } catch (e) { /* 무시 */ } }
  }

  /* 서버 저장에 실패한 변경이 있는지 ("1" = 아직 서버에 못 보냄)
   * 표시가 있으면 다음에 화면을 열 때 서버 것을 받지 않고 이 기기 것을 먼저 올린다
   * (서버가 꺼져 있던 동안 고친 내용이 예전 서버 값으로 덮이지 않게) */
  var PENDING_KEY = 'wakeup.pending';
  function setPending(on) {
    var ls = storageArea();
    if (!ls) return;
    try { if (on) ls.setItem(PENDING_KEY, '1'); else ls.removeItem(PENDING_KEY); } catch (e) { /* 무시 */ }
  }
  function hasPending() {
    var ls = storageArea();
    try { return !!ls && ls.getItem(PENDING_KEY) === '1'; } catch (e) { return false; }
  }

  function makeSyncCode() {
    var out = '';
    var buf = new Uint8Array(8);
    root.crypto.getRandomValues(buf);
    for (var i = 0; i < 8; i++) out += CODE_CHARS[buf[i] % CODE_CHARS.length];
    return out;
  }

  function request(method, code, body) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var opts = { method: method, cache: 'no-store', headers: {} };
    if (ctrl) opts.signal = ctrl.signal;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(API + code, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, ok: res.ok, data: data };
      });
    }, function () {
      if (timer) clearTimeout(timer);
      throw new Error('서버에 연결하지 못했어요');
    });
  }

  /** 서버에 저장 → Promise (실패 시 Error) */
  function pushRemote(code, profile) {
    if (!isValidCode(code)) return Promise.reject(new Error('동기화 코드 형식이 잘못됐어요'));
    return request('PUT', code, sanitize(profile)).then(function (r) {
      if (!r.ok) throw new Error((r.data && r.data.error) || '서버 저장 실패 (' + r.status + ')');
      setPending(false);
      return true;
    }).catch(function (e) {
      setPending(true);
      throw e;
    });
  }

  /** 서버에서 불러오기 → Promise<profile | null(그 코드로 저장된 것 없음)> */
  function pullRemote(code) {
    if (!isValidCode(code)) return Promise.reject(new Error('동기화 코드는 영문 소문자 · 숫자 8자리예요'));
    return request('GET', code).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error((r.data && r.data.error) || '서버에서 불러오지 못했어요 (' + r.status + ')');
      return sanitize(r.data);
    });
  }

  /** 이 기기에만 저장 (검사 없이, 서버에서 받은 값 보관용) */
  function saveLocalOnly(profile) {
    var ls = storageArea();
    if (!ls) return false;
    try { ls.setItem(KEY, JSON.stringify(sanitize(profile))); return true; } catch (e) { return false; }
  }

  /**
   * 화면 시작용: 동기화 코드가 있으면 서버 → 없거나 실패하면 이 기기 저장본 (plan.md 2단계)
   * → Promise<{ profile, source: 'server' | 'local' | 'none', warning }>
   */
  function loadSynced() {
    var local = load();
    var code = getSyncCode();
    if (!code) return Promise.resolve({ profile: local, source: local ? 'local' : 'none', warning: '' });
    if (local && hasPending()) {
      // 서버에 못 보낸 변경이 있으면 이 기기 것을 먼저 올린다
      return pushRemote(code, local).then(function () {
        return { profile: local, source: 'local', warning: '' };
      }, function (e) {
        return { profile: local, source: 'local',
          warning: e.message + ' — 이 기기에서 고친 내용이 아직 서버에 저장되지 않았어요.' };
      });
    }
    return pullRemote(code).then(function (remote) {
      if (remote && validate(remote).length === 0) {
        saveLocalOnly(remote);
        return { profile: remote, source: 'server', warning: '' };
      }
      return { profile: local, source: local ? 'local' : 'none', warning: '' };
    }, function (e) {
      return { profile: local, source: local ? 'local' : 'none',
        warning: e.message + ' — 이 기기에 저장된 시간표를 보여 줘요.' };
    });
  }

  /* ---------- 11/21 개편: 에타 가져오기 · 10분 전 알림 기록 · 예시 체험 ---------- */
  var IMPORT_API = 'api/import/everytime';       // 상대 경로 → /wakeup/api/import/everytime
  var ALERTED_KEY = 'wakeup.alerted';
  var DEMO_KEY = 'wakeup.demo';

  /**
   * 에타 공개 공유 링크 가져오기 (서버가 변환, 저장은 하지 않음)
   * → Promise<{ year, semester, classes, skipped, warnings }>
   *   실패: Error (err.reason = invalid_url · not_found · private · empty · upstream · rate_limited · network)
   */
  function importEverytime(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    var opts = { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ url: url }) };
    if (ctrl) opts.signal = ctrl.signal;
    function err(reason, msg) { var e = new Error(msg); e.reason = reason; return e; }
    return fetch(IMPORT_API, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok && data && data.ok) return data;
        throw err(data.reason || 'upstream', data.error || '시간표를 가져오지 못했어요 (' + res.status + ')');
      });
    }, function () {
      if (timer) clearTimeout(timer);
      throw err('network', '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
    });
  }

  /* ---------- 11/21 통학 시간 계산: 출발지 → 도착지 이동 시간 ----------
   * 서버 api/commute/route 가 길찾기 API(ODsay, 연결 예정)로 계산한다. 출발지 · 도착지는 계산에만 쓰고 저장하지 않는다.
   * 서버 응답 약속: 200 { ok, minutes, summary, transfers, source }
   *               실패 { error, reason } — reason: not_configured(키 없음) · not_found(장소 못 찾음) · upstream · rate_limited
   * 연결 전(404 · 405 · 501) · 키 없음 · 길찾기 서버 일시 장애(5xx · upstream · rate_limited) · 네트워크 오류
 *   → err.reason = 'unavailable' → 화면이 지하철 시각표 · 직접 입력으로 대신한다. 장소를 못 찾으면(not_found) 그 안내를 그대로. */
  var ROUTE_API = 'api/commute/route';
  var SUBWAY_URL = 'data/subway/line2.json';

  function commuteRoute(from, to) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
    var opts = { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ from: text(from), to: text(to) }) };
    if (ctrl) opts.signal = ctrl.signal;
    function err(reason, msg) { var e = new Error(msg); e.reason = reason; return e; }
    return fetch(ROUTE_API, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok && data && data.ok && Number(data.minutes) > 0) return data;
        if ([404, 405, 501, 502, 503, 504].indexOf(res.status) >= 0 ||
            ['not_configured', 'upstream', 'rate_limited'].indexOf(data.reason) >= 0) {
          throw err('unavailable', '길찾기 API 연결 전이에요');
        }
        throw err(data.reason || 'upstream', data.error || '이동 시간을 계산하지 못했어요 (' + res.status + ')');
      });
    }, function () {
      if (timer) clearTimeout(timer);
      throw err('unavailable', '길찾기 서버에 연결하지 못했어요');
    });
  }

  /** 대구 2호선 역별 영남대까지 걸리는 시간 (server/build_subway.py 가 대구교통공사 CSV 로 만든 파일) */
  function loadSubway() {
    return fetch(SUBWAY_URL, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('지하철 시각표를 불러오지 못했어요');
      return res.json();
    });
  }

  /** 가져온 수업으로 시간표 교체 (통학 · 알림 설정은 유지) → save() 결과 */
  function replaceClasses(classes) {
    var p = load() || emptyProfile();
    p.classes = classes;
    return save(p);
  }

  /** 10분 전 알림 기록 { date, keys } (없으면 null) */
  function getAlerted() {
    var ls = storageArea();
    try {
      var obj = ls ? JSON.parse(ls.getItem(ALERTED_KEY) || 'null') : null;
      return obj && typeof obj === 'object' ? obj : null;
    } catch (e) { return null; }
  }

  function setAlerted(record) {
    var ls = storageArea();
    if (!ls) return;
    try { ls.setItem(ALERTED_KEY, JSON.stringify({ date: record.date, keys: record.keys.slice(-200) })); } catch (e) { /* 무시 */ }
  }

  function sessionArea() {
    try { return root.sessionStorage || null; } catch (e) { return null; }
  }

  /** 예시 체험 상태 (이 탭에서만, 저장하지 않음) → { date, extra:[체험 수업] } 또는 null */
  function getDemo() {
    var ss = sessionArea();
    try {
      var obj = ss ? JSON.parse(ss.getItem(DEMO_KEY) || 'null') : null;
      return obj && Array.isArray(obj.extra) ? obj : null;
    } catch (e) { return null; }
  }

  function setDemo(obj) {
    var ss = sessionArea();
    if (ss) { try { ss.setItem(DEMO_KEY, JSON.stringify(obj)); } catch (e) { /* 무시 */ } }
  }

  function clearDemo() {
    var ss = sessionArea();
    if (ss) { try { ss.removeItem(DEMO_KEY); } catch (e) { /* 무시 */ } }
  }

  var seq = 0;
  /** 새 수업 id (한 화면 안에서 겹치지 않게) */
  function newClassId() {
    seq += 1;
    return 'c' + Date.now().toString(36) + seq;
  }

  var api = {
    KEY: KEY,
    emptyProfile: emptyProfile,
    sanitize: sanitize,
    validate: validate,
    customToRoute: customToRoute,
    load: load,
    save: save,
    clear: clear,
    loadSample: loadSample,
    newClassId: newClassId,
    isValidCode: isValidCode,
    getSyncCode: getSyncCode,
    setSyncCode: setSyncCode,
    clearSyncCode: clearSyncCode,
    hasPending: hasPending,
    makeSyncCode: makeSyncCode,
    pushRemote: pushRemote,
    pullRemote: pullRemote,
    saveLocalOnly: saveLocalOnly,
    loadSynced: loadSynced,
    importEverytime: importEverytime,
    commuteRoute: commuteRoute,
    loadSubway: loadSubway,
    replaceClasses: replaceClasses,
    getAlerted: getAlerted,
    setAlerted: setAlerted,
    getDemo: getDemo,
    setDemo: setDemo,
    clearDemo: clearDemo
  };

  root.WakeStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
