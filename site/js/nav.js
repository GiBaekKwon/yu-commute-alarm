/*
 * nav.js — 하단 탭 (대시보드 · 설정). 넓은 화면에서는 CSS 가 가운데 떠 있는 알약 모양으로 바꾼다.
 * 각 페이지 </body> 바로 앞에서 불러온다. 링크는 상대 경로, 아이콘은 인라인 SVG (외부 파일 없음).
 */
(function () {
  'use strict';

  var TABS = [
    { href: 'index.html', label: '대시보드',
      svg: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>' },
    { href: 'setup.html', label: '설정',
      svg: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>' }
  ];

  var file = location.pathname.split('/').pop() || 'index.html';

  var nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.setAttribute('aria-label', '화면 이동');

  TABS.forEach(function (t) {
    var a = document.createElement('a');
    a.href = t.href;
    if (t.href === file) a.setAttribute('aria-current', 'page');
    var ico = document.createElement('span');
    ico.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + t.svg + '</svg>';
    var label = document.createElement('span');
    label.textContent = t.label;
    a.appendChild(ico.firstChild);
    a.appendChild(label);
    nav.appendChild(a);
  });

  document.body.appendChild(nav);
})();
