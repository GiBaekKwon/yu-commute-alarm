/*
 * bus.js — 버스 노선 데이터 불러오기
 * time.js · calc.js · storage.js 를 먼저 불러와야 한다.
 *
 * 데이터: data/bus/routes.json (목록) + data/bus/route-*.json (plan.md 2-2)
 * fetch 는 상대 경로라 /wakeup/ 아래에서도 동작한다.
 * 주의: 파일을 더블클릭(file://)으로 열면 브라우저가 fetch 를 막는다 → 웹 서버로 열 것.
 */
(function (root) {
  'use strict';

  var C = root.WakeCalc || (typeof require !== 'undefined' ? require('./calc.js') : null);
  var S = root.WakeStorage || (typeof require !== 'undefined' ? require('./storage.js') : null);

  var BASE = 'data/bus/';
  var FILE_OK = /^route-[a-z0-9-]+\.json$/;   // routes.json 의 file 값은 이 형식만 허용

  var routesPromise = null;
  var routeCache = {};

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('버스 데이터를 불러오지 못했어요 (' + res.status + ')');
      return res.json();
    }, function () {
      throw new Error('버스 데이터를 불러오지 못했어요. 인터넷 연결을 확인하거나 웹 서버 주소로 열어 주세요');
    });
  }

  /** 노선 목록 → Promise<[{ id, name, file }]> */
  function loadRoutes() {
    if (!routesPromise) {
      routesPromise = getJSON(BASE + 'routes.json').then(function (list) {
        if (!Array.isArray(list)) throw new Error('routes.json 형식이 잘못됐어요');
        return list.filter(function (r) {
          return r && typeof r.id === 'string' && typeof r.name === 'string' && FILE_OK.test(r.file);
        });
      });
      routesPromise.catch(function () { routesPromise = null; });   // 실패하면 다음에 다시 시도
    }
    return routesPromise;
  }

  /** 노선 하나 → Promise<route> (검사 통과한 것만) */
  function loadRoute(id) {
    if (routeCache[id]) return routeCache[id];
    var p = loadRoutes().then(function (list) {
      var meta = list.filter(function (r) { return r.id === id; })[0];
      if (!meta) throw new Error('등록된 노선을 찾을 수 없어요: ' + id);
      return getJSON(BASE + meta.file);
    }).then(function (route) {
      var errors = C.validateRoute(route);
      if (errors.length) throw new Error('노선 데이터 오류 (' + id + '): ' + errors[0].msg);
      return route;
    });
    routeCache[id] = p;
    p.catch(function () { delete routeCache[id]; });
    return p;
  }

  /** 프로필의 통학 설정에 맞는 노선 → Promise<route> (직접 입력이 우선) */
  function resolveRoute(commute) {
    if (C.isTravelMode(commute)) return Promise.resolve(null);   // 이동 시간 모드는 노선 없음
    if (commute && commute.customTimes) return Promise.resolve(S.customToRoute(commute.customTimes));
    if (commute && commute.routeId) return loadRoute(commute.routeId);
    return Promise.reject(new Error('노선이 등록되지 않았어요'));
  }

  /** 화면 표시용 노선 이름 */
  function routeLabel(route) {
    if (!route) return '';
    var name = route.name || route.id;
    return route.isExample ? name + ' (예시 데이터)' : name;
  }

  var api = {
    loadRoutes: loadRoutes,
    loadRoute: loadRoute,
    resolveRoute: resolveRoute,
    routeLabel: routeLabel
  };

  root.WakeBus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
