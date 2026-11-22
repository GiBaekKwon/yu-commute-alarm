/*
 * gate.js — 처음 온 사람만 첫 페이지(start.html)로 보낸다. index.html <head> 에서 가장 먼저 불러온다.
 * 보내는 조건: 이 기기에 저장된 시간표(wakeup.v1) · 동기화 코드(wakeup.sync) · [시작하기] 기록(wakeup.started) 이 모두 없을 때.
 * localStorage 를 못 쓰는 브라우저에서는 보내지 않는다 (start.js 가 기록을 못 남겨 계속 되돌아오는 것 방지).
 * 예시 · 알림 재현 주소(index.html?demo=9 등, 발표 · 시연용)는 보내지 않는다.
 */
(function () {
  'use strict';
  try {
    if (/[?&]demo=/.test(window.location.search)) return;
    var ls = window.localStorage;
    if (!ls.getItem('wakeup.v1') && !ls.getItem('wakeup.sync') && !ls.getItem('wakeup.started')) {
      ls.setItem('wakeup.gate-test', '1');      // 쓰기 가능한지 확인 (못 쓰면 예외 → 보내지 않음)
      ls.removeItem('wakeup.gate-test');
      window.location.replace('start.html');
    }
  } catch (e) { /* 저장소를 못 쓰면 그냥 대시보드 */ }
})();
