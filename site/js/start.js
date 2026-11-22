/*
 * start.js — 첫 페이지 (start.html)
 * [시작하기] → localStorage["wakeup.started"] 를 남기고 대시보드로. 다음부터는 gate.js 가 첫 페이지로 보내지 않는다.
 * 저장이 막힌 브라우저(사생활 보호 모드 등)에서도 링크 자체(href="index.html")는 그대로 동작한다.
 * 연출(11/21, 스타일은 style.css "첫 페이지 연출"):
 *   A 인트로(#ws-intro)가 줄어들 목표 = 카드 장면(#ws-scene)의 화면 위치 → --wi-t/r/b/l 로 넣는다.
 *     화면 탭 · 아무 키 → 건너뛰기(.ws-skipped). 인트로 자체는 CSS 만으로도 끝난다 (스크립트가 없어도 화면이 막히지 않음).
 *   B [시작하기] → 버스 출발(.ws-scene.go) + 버튼 위치에서 원이 퍼짐(.ws-leaving) → LEAVE_MS 뒤 이동.
 *     동작 줄이기 설정 · 새 탭 열기(Ctrl/⌘/Shift/가운데 클릭) → 기다리지 않고 바로 링크대로.
 */
(function () {
  'use strict';
  var LEAVE_MS = 900;
  var root = document.documentElement;
  var intro = document.getElementById('ws-intro');
  var scene = document.getElementById('ws-scene');
  var btn = document.getElementById('start');

  function fitIntroTarget() {
    if (!scene) return;
    var r = scene.getBoundingClientRect();
    root.style.setProperty('--wi-t', Math.max(0, r.top) + 'px');
    root.style.setProperty('--wi-l', Math.max(0, r.left) + 'px');
    root.style.setProperty('--wi-r', Math.max(0, window.innerWidth - r.right) + 'px');
    root.style.setProperty('--wi-b', Math.max(0, window.innerHeight - r.bottom) + 'px');
  }
  function skipIntro() { root.classList.add('ws-skipped'); }

  if (intro) {
    fitIntroTarget();
    window.addEventListener('resize', fitIntroTarget);
    intro.addEventListener('click', skipIntro);
    window.addEventListener('keydown', function onKey() { skipIntro(); window.removeEventListener('keydown', onKey); });
  }

  if (!btn) return;
  btn.addEventListener('click', function (e) {
    try { window.localStorage.setItem('wakeup.started', '1'); } catch (err) { /* 저장 못 해도 이동은 한다 */ }
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    e.preventDefault();
    if (root.classList.contains('ws-leaving')) return;
    var r = btn.getBoundingClientRect();
    root.style.setProperty('--wx', Math.round(r.left + r.width / 2) + 'px');
    root.style.setProperty('--wy', Math.round(r.top + r.height / 2) + 'px');
    root.classList.add('ws-skipped', 'ws-leaving');
    if (scene) scene.classList.add('go');
    setTimeout(function () { window.location.href = btn.href; }, LEAVE_MS);
  });
})();
