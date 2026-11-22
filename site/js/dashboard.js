/*
 * dashboard.js — 대시보드 (index.html)  plan.md A장
 * time.js · calc.js · classes.js · storage.js · bus.js 를 먼저 불러와야 한다.
 *
 * 화면 상태 (mode) — <body data-mode> 에도 적어 CSS 가 배치를 바꾼다
 *   'first' : 저장된 시간표 없음 → 예시 주간 시간표 + [에타 시간표 등록] (알림 없음)
 *   'demo'  : 예시 시간표로 체험 → 예시 데이터로 대시보드 · 10분 전 알림 (저장 안 함, sessionStorage)
 *   'mine'  : 저장된 내 시간표 → 대시보드 + [시간표 다시 등록]
 * 1초마다 tick(): 다음 수업 카운트다운 · 오늘 남은 수업 · 10분 전 배너 · 주간 시간표의 현재 시각 선.
 */
(function () {
  'use strict';

  var T = window.WakeTime, C = window.WakeCalc, W = window.WakeClasses, S = window.WakeStorage, B = window.WakeBus, M = window.WakeCommute;
  var DAY_NAME = ['일', '월', '화', '수', '목', '금', '토'];
  var ORDER = [1, 2, 3, 4, 5, 6, 0];
  var BASE_TITLE = document.title;
  var DEMO_NAME = '알림 체험 수업';

  // 화면에 그리는 작은 아이콘 (인라인 SVG, 외부 파일 없음)
  var ICONS = {
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    bus: '<rect x="5" y="3.5" width="14" height="13.5" rx="2.5"/><path d="M5 10.5h14M8 20v-3M16 20v-3M8.5 13.8h.01M15.5 13.8h.01"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 10"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>'
  };

  var clockFn = function () { return new Date(); };   // 테스트에서 시각을 고정할 수 있게
  function clock() { return clockFn(); }
  var $ = function (id) { return document.getElementById(id); };
  var state = {
    mode: 'loading',
    profile: null,       // 저장된 내 프로필
    sample: null,        // 예시 프로필 (data/sample-timetable.json)
    imported: null,      // 가져온 결과 (미리보기 중)
    active: null,        // 표시 중인 10분 전 알림 { cls, key, date }
    week: null,          // 주간 시간표 그리기 정보 { from, to, today, line, blocks }
    subway: null,        // 대구 2호선 역별 영남대까지 시간 (data/subway/line2.json)
    plan: null,          // 통학 계획 { commute, route, week(calcWeek 결과) }
    cmOpen: false,       // 통학 시간 계산 패널 열림
    renderedDate: '',
    warning: ''
  };

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'className') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function icon(name) {
    var s = el('span', { className: 'ico-wrap', 'aria-hidden': 'true' });
    s.innerHTML = '<svg class="ico" viewBox="0 0 24 24">' + ICONS[name] + '</svg>';
    return s.firstChild;
  }
  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  function setStatus(kind, msg) {
    var s = $('status');
    s.className = 'notice' + (kind ? ' notice-' + kind : '');
    s.textContent = msg || '';
  }

  /* ---------- 지금 보여 줄 수업 ---------- */
  function demoExtra(now) {
    var d = S.getDemo();
    if (!d || d.date !== W.dateKey(now)) return [];
    return d.extra;
  }

  function currentClasses(now) {
    if (state.mode === 'mine') return state.profile.classes;
    if (state.mode === 'demo') return state.sample.classes.concat(demoExtra(now));
    if (state.mode === 'first') return state.sample ? state.sample.classes : [];
    return [];
  }

  function currentCommute() {
    if (state.mode === 'mine') return state.profile.commute;
    if (state.mode === 'demo') return demoCommute();
    return null;
  }

  function isExample() { return state.mode !== 'mine'; }
  function isLive() { return state.mode === 'mine' || state.mode === 'demo'; }

  /* ---------- 전체 그리기 (데이터 · 상태가 바뀔 때) ---------- */
  function render() {
    var now = clock();
    var mine = state.mode === 'mine';
    document.body.setAttribute('data-mode', state.mode);
    var label = $('btn-register-label');
    label.textContent = '';
    if (mine) { label.appendChild(el('span', { className: 'hide-sm', text: '시간표 ' })); label.appendChild(document.createTextNode('다시 등록')); }
    else label.textContent = '에타 시간표 등록';
    $('btn-register').classList.toggle('btn-primary', !mine);   // 등록 전 · 체험 중에는 가장 눈에 띄는 행동
    show('intro', state.mode === 'first');
    show('demo-bar', state.mode === 'demo');
    show('next-card', isLive());
    show('today-card', isLive());
    show('week-card', state.mode !== 'loading');
    show('week-badge', isExample());
    renderWeek(now);
    renderCommute();
    renderExt();
    state.renderedDate = W.dateKey(now);
    tick();
  }

  /* ---------- 다음 수업 카드: 남은 시간 → 과목명 → 시작 시각 · 강의실 ---------- */
  function whenText(n, now) {
    if (n.offset === 0) return '오늘 ' + n.cls.start;
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n.offset);
    var head = n.offset === 1 ? '내일 · ' : '';
    return head + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + DAY_NAME[d.getDay()] + ') ' + n.cls.start;
  }

  /** "1일 06:50:00" → 일 · 시:분(크게) · :초(작게). 글자 내용은 W.countdownLong 그대로 */
  function countEl(sec, urgent) {
    var text = W.countdownLong(sec);
    var p = el('p', { className: 'count' + (urgent ? ' is-urgent' : '') });
    var m = /^(\d+일 )?(\d+):(\d\d):(\d\d)$/.exec(text);
    if (!m) { p.textContent = text; return p; }
    if (m[1]) p.appendChild(el('span', { className: 'cd-day', text: m[1] }));
    p.appendChild(el('span', { className: !m[1] && m[2] === '00' ? 'cd-dim' : '', text: m[2] + ':' }));
    p.appendChild(el('span', { className: 'cd-m', text: m[3] }));
    p.appendChild(el('span', { className: 'cd-s', text: ':' + m[4] }));
    return p;
  }

  function renderNext(classes, now) {
    var body = $('next-body');
    body.textContent = '';
    var n = W.nextClass(classes, now);
    var cur = W.currentClass(classes, now);
    var urgent = !!(n && n.offset === 0 && n.secondsLeft <= W.ALERT_SEC);
    $('next-card').classList.toggle('is-urgent', urgent);
    if (cur) {
      body.appendChild(el('p', { className: 'now-pill' }, [
        el('span', { className: 'pulse', 'aria-hidden': 'true' }),
        '지금 수업 중 · ' + cur.name + (cur.room ? ' (' + cur.room + ')' : '') + ' ~' + cur.end
      ]));
    }
    if (!n) {
      body.appendChild(el('p', { className: 'muted', text: '등록된 수업이 없어요.' }));
      return;
    }
    body.appendChild(countEl(n.secondsLeft, urgent));
    if (n.offset > 0) body.appendChild(el('p', { className: 'count-note', text: '오늘 남은 수업이 없어 다음 수업일까지 남은 시간이에요' }));
    body.appendChild(el('p', { className: 'next-name' }, [
      el('span', { text: n.cls.name || '수업' }),
      n.cls.id.indexOf('demo') === 0 ? el('span', { className: 'badge badge-example', text: '체험' }) : null
    ]));
    body.appendChild(el('p', { className: 'next-meta' }, [
      el('span', { className: 'next-when' }, [icon('clock'), whenText(n, now) + ' 시작']),
      n.cls.room ? el('span', { className: 'next-room' }, [el('span', { className: 'sr-only', text: ' · ' }), icon('pin'), n.cls.room]) : null
    ]));
    var strip = commuteStrip(now);
    if (strip) body.appendChild(strip);
    var alertMin = T.toMin(n.cls.start) - W.ALERT_SEC / 60;
    if (n.offset === 0 && !urgent && alertMin >= 0) {
      body.appendChild(el('p', { className: 'next-alert' }, [icon('bell'), T.toClock(alertMin).text + '에 이 화면에서 10분 전 알림을 띄워요']));
    }
  }

  /* ---------- 오늘 남은 수업 ---------- */
  function renderToday(classes, now) {
    var body = $('today-body');
    body.textContent = '';
    var left = W.remainingToday(classes, now);
    $('today-count').textContent = left.length ? left.length + '개' : '';
    if (!left.length) {
      body.appendChild(el('p', { className: 'empty-today', text: '오늘 남은 수업 없음' }));
      return;
    }
    var cur = W.currentClass(classes, now);
    var n = W.nextClass(classes, now);
    var ul = el('ul', { className: 'class-left' });
    left.forEach(function (c) {
      var isNow = !!(cur && c.id === cur.id);
      var isNext = !isNow && !!(n && n.offset === 0 && blockKey(n.cls) === blockKey(c));
      ul.appendChild(el('li', { className: isNow ? 'is-now' : (isNext ? 'is-next' : '') }, [
        el('span', { className: 't' }, [el('span', { className: 't-start', text: c.start }), el('span', { className: 't-end', text: '–' + c.end })]),
        el('span', { className: 'c' }, [
          el('span', { className: 'n', text: c.name || '수업' }),
          c.room ? el('span', { className: 'r', text: c.room }) : null
        ]),
        isNow ? el('span', { className: 'tag', text: '수업 중' }) : null
      ]));
    });
    body.appendChild(ul);
  }

  /* ---------- 주간 시간표 ---------- */
  function blockKey(c) { return c.id + '|' + c.day + '|' + c.start; }

  function renderLegend(example) {
    var lg = $('week-legend');
    lg.textContent = '';
    if (example && state.mode === 'first') {
      lg.appendChild(el('span', {}, [el('i', { className: 'sw sw-example', 'aria-hidden': 'true' }), '예시 수업 · 등록하면 내 시간표로 바뀌어요']));
      return;
    }
    lg.appendChild(el('span', {}, [el('i', { className: 'sw sw-next', 'aria-hidden': 'true' }), '다음 수업']));
    lg.appendChild(el('span', {}, [el('i', { className: 'sw sw-now', 'aria-hidden': 'true' }), '지금']));
  }

  function renderWeek(now) {
    var body = $('week-body');
    body.textContent = '';
    state.week = null;
    var classes = currentClasses(now);
    var example = isExample();
    renderLegend(example);
    var days = ORDER.filter(function (d) { return (d >= 1 && d <= 5) || C.classesOfDay(classes, d).length > 0; });
    if (!classes.length) {
      body.appendChild(el('p', { className: 'muted', text: '수업이 없어요.' }));
      return;
    }
    var from = Math.min.apply(null, classes.map(function (c) { return T.toMin(c.start); }));
    var to = Math.max.apply(null, classes.map(function (c) { return T.toMin(c.end); }));
    from = Math.floor(from / 60) * 60;
    to = Math.ceil(to / 60) * 60;
    var today = now.getDay();
    var at = function (min) { return 'calc(var(--ppm) * ' + min + ')'; };   // 1분 = --ppm (CSS 에서 화면 폭별로 정함)

    var axis = el('div', { className: 'tt-axis', 'aria-hidden': 'true' });
    for (var h = from; h < to; h += 60) {
      var lab = el('span', { text: String(h / 60) });
      lab.style.top = at(h - from);
      axis.appendChild(lab);
    }
    var head = el('div', { className: 'tt-head' }, [el('span')]);
    var grid = el('div', { className: 'tt-body' }, [axis]);
    var info = { from: from, to: to, today: null, line: null, blocks: [] };
    days.forEach(function (d) {
      head.appendChild(el('span', { text: DAY_NAME[d], className: d === today ? 'is-today' : '' }));
      var col = el('div', { className: 'tt-col' + (d === today ? ' is-today' : '') });
      C.classesOfDay(classes, d).forEach(function (c) {
        var s = T.toMin(c.start), e = T.toMin(c.end);
        var b = el('div', {
          className: 'tt-block' + (example ? ' is-example' : '') + (c.id.indexOf('demo') === 0 ? ' is-demo' : ''),
          title: DAY_NAME[d] + ' ' + c.start + '–' + c.end + ' ' + c.name + (c.room ? ' · ' + c.room : '')
        }, [
          el('span', { className: 'tt-name', text: c.name || '수업' }),
          el('span', { className: 'tt-time', text: c.start }),
          c.room ? el('span', { className: 'tt-room', text: c.room }) : null
        ]);
        b.style.top = at(s - from);
        b.style.height = 'max(20px, calc(var(--ppm) * ' + (e - s) + ' - 2px))';
        col.appendChild(b);
        info.blocks.push({ el: b, key: blockKey(c), day: d, end: e });
      });
      if (d === today) {
        info.today = col;
        info.line = el('div', { className: 'tt-now hidden', 'aria-hidden': 'true' });
        col.appendChild(info.line);
      }
      grid.appendChild(col);
    });
    var tt = el('div', { className: 'tt' }, [head, grid]);
    tt.style.setProperty('--cols', days.length);
    tt.style.setProperty('--span', to - from);
    body.appendChild(tt);
    if (example && state.mode === 'demo') body.appendChild(el('p', { className: 'tt-note', text: '줄무늬 칸은 예시 수업이에요. 내 시간표를 등록하면 바뀌어요.' }));
    state.week = info;
  }

  /** 매초: 현재 시각 선 · 다음 수업 칸 강조 · 끝난 오늘 수업 흐리게 */
  function updateWeekLive(classes, now) {
    var wk = state.week;
    if (!wk) return;
    var live = isLive();
    var nowMin = W.secOfDay(now) / 60;
    if (wk.line) {
      var inRange = live && nowMin >= wk.from && nowMin <= wk.to;
      wk.line.classList.toggle('hidden', !inRange);
      if (inRange) wk.line.style.top = 'calc(var(--ppm) * ' + nowMin.toFixed(2) + ' - var(--ppm) * ' + wk.from + ')';
    }
    var n = live ? W.nextClass(classes, now) : null;
    var nextKey = n ? blockKey(n.cls) : '';
    var today = now.getDay();
    wk.blocks.forEach(function (b) {
      b.el.classList.toggle('is-next', live && b.key === nextKey);
      b.el.classList.toggle('is-past', live && b.day === today && b.end <= nowMin);
    });
  }

  /* ---------- 통학 계획 (부가 기능이지만 주요) — plan.md A-1-2 ----------
   * 이동 시간 모드: 출발지 → 도착지 이동(길찾기 API · 연결 전엔 2호선 시각표 · 직접 입력) + 준비 + 여유
   *   → 총 소요 · 요일별 출발 · 기상 (팀원이 단축어 알람으로 등록). 출발지 · 도착지는 저장하지 않는다.
   * 옛 버스 시간표 모드(설정 화면에서 노선 선택)는 그대로 보여 준다 (호환). */
  var DEMO_FROM = '반월당';

  /** 예시 체험용 통학: 반월당역 → 영남대 (대구 2호선 시각표 기준), 준비 40 · 여유 10 */
  function demoCommute() {
    var sm = M.subwayMinutes(state.subway, DEMO_FROM, '영남대');
    return sm ? { prepMin: 40, travelMin: sm.minutes, bufferMin: 10 } : null;
  }

  function legend(kind, text) {
    return el('span', {}, [el('i', { className: 'tb tb-' + kind, 'aria-hidden': 'true' }), text]);
  }

  /** 총 소요 시간 + 준비 · 이동 · 여유 막대 */
  function totalView(cm, withCopy) {
    var b = M.breakdown(cm);
    var bar = el('div', { className: 'tbar', role: 'img', 'aria-label': '준비 ' + b.prep + '분 · 이동 ' + b.travel + '분 · 여유 ' + b.buffer + '분' });
    [['prep', b.prep], ['travel', b.travel], ['buffer', b.buffer]].forEach(function (x) {
      if (x[1] <= 0) return;
      var seg = el('span', { className: 'tb tb-' + x[0] });
      seg.style.flexGrow = String(x[1]);
      bar.appendChild(seg);
    });
    return el('div', { className: 'cm-sum' }, [
      el('div', { className: 'cm-sum-head' }, [
        el('div', {}, [el('p', { className: 'eyebrow', text: '총 소요 시간' }), el('p', { className: 'cm-total-num', text: M.duration(b.total) })]),
        withCopy ? el('button', { type: 'button', id: 'cm-copy', className: 'btn btn-sm' }, ['단축어용 복사']) : null
      ]),
      bar,
      el('p', { className: 'tbar-legend' }, [legend('prep', '준비 ' + b.prep + '분'), legend('travel', '이동 ' + b.travel + '분'), legend('buffer', '여유 ' + b.buffer + '분')])
    ]);
  }

  /** 요일별 표 (요일 · 첫 수업 · 출발 · 기상), hl = 강조할 요일 */
  function planTable(week, hl) {
    var rows = M.planRows(week);
    if (!rows.length) return el('p', { className: 'muted small', text: '이번 주에 수업이 없어요.' });
    var tb = el('tbody');
    rows.forEach(function (r) {
      tb.appendChild(el('tr', { className: r.day === hl ? 'is-hl' : '' }, [
        el('th', { scope: 'row', text: r.name }), el('td', { text: r.first }), el('td', { text: r.departure }), el('td', { className: 'w', text: r.wake })
      ]));
    });
    return el('table', { className: 'plan-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: '요일' }), el('th', { scope: 'col', text: '첫 수업' }), el('th', { scope: 'col', text: '출발' }), el('th', { scope: 'col', text: '기상' })])]),
      tb
    ]);
  }

  /* ---------- 아이폰 단축어로 요일별 알람 자동 등록 (docs/iphone-shortcut.md) ----------
   * 단축어 "통학알람"이 레이블에 "통학"이 든 알람을 모두 지우고, 받은 { 요일: 시각 }으로 요일 반복 알람을 만든다.
   * 설치 링크(iCloud)가 비어 있으면 ① 단계를 숨긴다.
   * PC(마우스 있는 화면)에서는 같은 주소를 QR 두 개로 보여 준다 → 아이폰 카메라로 스캔 (터치 기기는 CSS로 숨김).
   * QR 생성: js/vendor/qrcode.js (qrcode-generator 2.0.4, MIT — CLAUDE.md 규칙 1 예외) */
  var SHORTCUT_NAME = '통학알람';
  var SHORTCUT_INSTALL_URL = 'https://www.icloud.com/shortcuts/10955907e88e4cae89518cf10e769632';   // 단축어 공유 → iCloud 링크

  /** 글 → QR SVG (라이브러리가 없거나 실패하면 null — 버튼만 보여 줌) */
  function qrSvg(text, label) {
    if (typeof window.qrcode !== 'function') return null;
    var q;
    try { q = window.qrcode(0, 'M'); q.addData(text); q.make(); } catch (e) { return null; }
    var n = q.getModuleCount(), pad = 4, size = n + pad * 2, d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + pad) + ' ' + (r + pad) + 'h1v1h-1z';
    }
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    svg.setAttribute('shape-rendering', 'crispEdges');
    var bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#fff');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', '#000');
    svg.appendChild(bg); svg.appendChild(p);
    return svg;
  }

  function qrFigure(text, caption) {
    var svg = qrSvg(text, caption + ' QR 코드');
    return svg ? el('figure', {}, [svg, el('figcaption', { text: caption })]) : null;
  }

  /** demo = 예시 체험 모드 (평가 · 시연용): 예시 시각이라는 안내를 붙인다 */
  function shortcutView(week, demo) {
    var r = M.shortcutAlarms(week);
    if (!Object.keys(r.alarms).length) return null;
    var dn = ['일', '월', '화', '수', '목', '금', '토'];
    var runUrl = M.shortcutUrl(r.alarms, SHORTCUT_NAME);
    var steps = el('ol', { className: 'ext-steps' });
    if (SHORTCUT_INSTALL_URL) {
      steps.appendChild(el('li', {}, ['처음 한 번: ', el('a', { href: SHORTCUT_INSTALL_URL, target: '_blank', rel: 'noopener' }, ['단축어 설치']), ' → ', el('strong', { text: '단축어 추가' })]));
    }
    steps.appendChild(el('li', {}, ['아이폰에서 아래 버튼을 누르면 ', el('strong', { text: '요일 반복 알람' }), '이 시계 앱에 들어가요. 예전 "통학" 알람은 지우고 새로 만들어요.']));
    var notes = r.moved.map(function (a) { return dn[a.day] + '요일 기상은 자정 전이라 ' + dn[a.to] + '요일 ' + a.time + ' 알람으로 넣어요.'; })
      .concat(r.skipped.map(function (a) { return dn[a.day] + '요일 기상(' + dn[a.to] + '요일 ' + a.time + ')은 ' + dn[a.to] + '요일 알람과 겹쳐서 직접 맞춰 주세요.'; }));
    var install = SHORTCUT_INSTALL_URL ? qrFigure(SHORTCUT_INSTALL_URL, '① 단축어 설치 (처음 한 번)') : null;
    var run = qrFigure(runUrl, (install ? '② ' : '') + '알람 등록');
    var qr = run ? el('div', { className: 'sc-qr' }, [
      el('p', { className: 'small muted', text: 'PC에서 보고 있다면 아이폰 카메라로 QR을 찍어요.' }),
      el('div', { className: 'sc-qr-row' }, [install, run])
    ]) : null;
    return el('div', { className: 'cm-shortcut' }, [
      el('p', { className: 'eyebrow', text: '아이폰 알람 자동 등록' }),
      demo ? el('p', { className: 'notice notice-warn small', text: '예시 시간표 기준 알람이에요. 써 본 뒤에는 시계 앱에서 "통학." 알람을 지워 주세요 (이미 있던 "통학" 알람은 이 값으로 바뀌어요).' }) : null,
      steps,
      el('a', { href: runUrl, className: 'btn btn-primary btn-block' }, ['아이폰 알람 등록 (단축어 실행)']),
      qr,
      notes.length ? el('p', { className: 'small muted', text: notes.join(' ') }) : null,
      el('p', { className: 'small muted', text: '시간표나 통학 시간을 바꾸면 다시 눌러 주세요.' })
    ]);
  }

  function cmMsg(kind, msg) {
    var m = $('cm-msg');
    if (!m) return;
    m.className = 'notice small' + (kind ? ' notice-' + kind : '') + (msg ? '' : ' hidden');
    m.textContent = msg || '';
  }

  function renderCommute() {
    var body = $('commute-body');
    var cm = currentCommute();
    var travel = C.isTravelMode(cm);
    show('commute-card', isLive());
    show('cm-open', state.mode === 'mine');
    $('cm-open').textContent = state.cmOpen ? '닫기' : (travel ? '다시 계산' : '통학 시간 계산');
    body.textContent = '';
    state.plan = null;
    if (!cm) {
      body.appendChild(el('p', { className: 'cm-empty' }, [
        '출발지 · 도착지와 준비 · 여유 시간을 넣으면 요일별 ', el('strong', { text: '출발 · 기상 시각' }),
        '을 계산해요. 계산한 시각은 폰 단축어 알람에 그대로 쓸 수 있어요.'
      ]));
      return;
    }
    var classes = currentClasses(clock());
    if (travel) {
      state.plan = { commute: cm, route: null, week: C.calcWeek(classes, cm, null) };
      var st = M.stripState(state.plan.week, cm, null, clock());
      var hl = st.kind === 'before' || st.kind === 'missed' ? clock().getDay() : (st.kind === 'next' ? st.day.day : -1);
      body.appendChild(totalView(cm, true));
      body.appendChild(planTable(state.plan.week, hl));
      if (isLive()) {   // 예시 체험 모드에서도 보여 준다 (평가 · 시연용) — 예시 시각이라는 경고를 붙임
        var sc = shortcutView(state.plan.week, state.mode === 'demo');
        if (sc) body.appendChild(sc);
      }
      body.appendChild(el('p', { id: 'cm-msg', className: 'notice small hidden', role: 'status' }));
      body.appendChild(el('p', { className: 'cm-note' }, [state.mode === 'demo'
        ? '예시: ' + DEMO_FROM + '역 → 영남대 (대구 2호선 시각표 기준 ' + cm.travelMin + '분) · 준비 40분 · 여유 10분'
        : '이 표의 기상 시각으로 요일별 단축어 알람을 맞추세요. 출발지 · 도착지는 저장하지 않아요.']));
      return;
    }
    // 옛 버스 시간표 모드 (설정 화면에서 노선을 고른 경우)
    body.appendChild(el('p', { className: 'small muted', text: '불러오는 중…' }));
    B.resolveRoute(cm).then(function (route) {
      body.textContent = '';
      var week = C.calcWeek(classes, cm, route);
      state.plan = { commute: cm, route: route, week: week };
      var ul = el('ul', { className: 'commute-list' });
      ORDER.forEach(function (d) {
        var r = week[d];
        if (r.status === 'no-class') return;
        var right;
        if (r.status === 'no-bus') right = el('span', { className: 'muted', text: '이 요일 버스 없음' });
        else {
          right = el('span', {}, [
            el('strong', { text: T.label(r.wake) + ' 기상' }),
            ' · ' + T.label(r.departure) + ' 출발 · ' + T.label(r.bus) + ' 버스',
            r.status === 'late' ? el('span', { className: 'late', text: ' (첫차도 약 ' + r.lateMin + '분 지각)' }) : null
          ]);
        }
        ul.appendChild(el('li', {}, [
          el('span', { className: 'cday', text: DAY_NAME[d] }),
          el('span', { className: 'cfirst muted small', text: '첫 수업 ' + r.firstClass.start }),
          right
        ]));
      });
      body.appendChild(ul);
      var edit = el('button', { type: 'button', className: 'btn btn-sm', text: '통학 시간 계산으로 바꾸기' });
      edit.addEventListener('click', openCommuteForm);    // 11/21 설정 화면의 버스 시간표 입력은 없앰 → 여기서 바꾼다
      body.appendChild(el('p', { className: 'small muted' }, [
        B.routeLabel(route) + ' · 버스 ' + route.rideMin + '분 · 준비 ' + cm.prepMin + '분 ', edit
      ]));
      if (route.isExample) body.appendChild(el('p', { className: 'notice notice-warn small', text: '예시 버스 데이터예요 (실제 시간표 아님). "통학 시간 계산"으로 바꿀 수 있어요.' }));
      if (isLive()) {   // 버스 시간표 모드도 같은 요일별 기상 시각으로 아이폰 알람 등록
        var sc = shortcutView(week, state.mode === 'demo');
        if (sc) body.appendChild(sc);
      }
    }, function (e) {
      body.textContent = '';
      body.appendChild(el('p', { className: 'notice notice-err small', text: e.message }));
    });
  }

  /* ---------- 다음 수업 카드 아래 통학 띠 (매초) ---------- */
  function clockLeft(sec) {
    var t = T.countdown(sec);                          // HH:MM:SS
    return t.indexOf('00:') === 0 ? t.slice(3) : t.replace(/^0/, '');
  }

  function dayWord(offset, now) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (offset === 1) return '내일(' + DAY_NAME[d.getDay()] + ')';
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + DAY_NAME[d.getDay()] + ')';
  }

  function commuteStrip(now) {
    var cm = currentCommute();
    var ico = icon('bus');
    if (!cm) {
      if (state.mode !== 'mine') return null;
      return el('div', { className: 'cstrip is-cta' }, [
        el('span', { className: 'cs-ico' }, [ico]),
        el('p', { className: 'cs-main cs-title', text: '통학 시간을 넣으면 출발 · 기상 시각도 알려 드려요' }),
        el('button', { type: 'button', className: 'btn btn-sm', 'data-action': 'commute', text: '설정' })
      ]);
    }
    var plan = state.plan;
    if (!plan) return null;
    var st = M.stripState(plan.week, plan.commute, plan.route, now);
    if (st.kind === 'none') return null;
    var travel = C.isTravelMode(plan.commute);
    var total = travel ? ' · 총 ' + M.duration(M.breakdown(plan.commute).total) : '';
    var cls = 'cstrip', title, sub;
    if (st.kind === 'before') {
      title = ['출발까지 ', el('b', { className: 'cs-count', text: clockLeft(st.secondsLeft) })];
      sub = T.label(st.day.departure) + ' 출발 · ' + T.label(st.day.wake) + ' 기상 기준' + total;
    } else if (st.kind === 'missed') {
      cls += ' is-missed';
      title = ['출발 시각 ' + T.label(st.day.departure) + '이 지났어요'];
      var ck = st.check;
      if (ck.status === 'missed' && ck.arrival != null) sub = '지금 나가면 ' + T.label(ck.arrival) + ' 도착' + (ck.lateMin > 0 ? ' · 약 ' + ck.lateMin + '분 지각' : ' · 여유 시간이 줄었어요');
      else if (ck.status === 'missed') sub = '다음 버스 ' + T.label(ck.nextBus) + (ck.lateMin > 0 ? ' · 약 ' + ck.lateMin + '분 지각' : '');
      else if (ck.status === 'no-more-bus') sub = '오늘 남은 버스가 없어요';
      else sub = '첫 수업 ' + st.day.firstClass.start;
    } else {
      title = [dayWord(st.offset, now) + ' ' + T.label(st.day.wake) + ' 기상'];
      sub = T.label(st.day.departure) + ' 출발 · 첫 수업 ' + st.day.firstClass.start + total;
    }
    return el('div', { className: cls }, [
      el('span', { className: 'cs-ico' }, [ico]),
      el('div', { className: 'cs-main' }, [el('p', { className: 'cs-title' }, title), el('p', { className: 'cs-sub', text: sub })])
    ]);
  }

  /* ---------- 통학 시간 계산 패널: 출발 · 도착 → 이동 시간 → 저장 ---------- */
  var CM_FIELD = { prepMin: 'cm-prep', travelMin: 'cm-travel', bufferMin: 'cm-buffer' };

  function inputMin(id) {
    var v = $(id).value.trim();
    return v === '' ? '' : Number(v);
  }

  /** 준비 · 여유는 비워 두면 칸의 회색 글씨(placeholder) 값으로 계산 · 저장 (11/21, 기본 30분 · 10분) */
  function inputMinOrDefault(id) {
    var v = inputMin(id);
    return v === '' ? Number($(id).getAttribute('placeholder')) : v;
  }

  function cmCandidate() {
    return { prepMin: inputMinOrDefault('cm-prep'), travelMin: inputMin('cm-travel'), bufferMin: inputMinOrDefault('cm-buffer') };
  }

  function openCommuteForm() {
    if (state.mode !== 'mine') return;
    var cm = state.profile.commute;
    state.cmOpen = true;
    show('commute-form', true);
    show('cm-result', false);
    show('cm-loading', false);
    $('cm-open').textContent = '닫기';
    $('cm-prep').value = cm && cm.prepMin !== '' && cm.prepMin != null ? cm.prepMin : '';
    $('cm-buffer').value = cm && cm.bufferMin !== '' && cm.bufferMin != null ? cm.bufferMin : '';
    $('cm-travel').value = C.isTravelMode(cm) ? cm.travelMin : '';
    $('cm-form-err').textContent = '';
    $('cm-err').textContent = '';
    $('cm-from').removeAttribute('aria-invalid');
    setSteps('#cm-steps li', 1);
    $('commute-card').scrollIntoView({ block: 'start' });
    $('cm-from').focus();
  }

  function closeCommuteForm() {
    state.cmOpen = false;
    show('commute-form', false);
    renderCommute();
  }

  function updateCmPreview() {
    var cand = cmCandidate();
    var errs = C.validateCommute(cand);
    Object.keys(CM_FIELD).forEach(function (f) { $(CM_FIELD[f]).removeAttribute('aria-invalid'); });
    errs.forEach(function (e) { if (CM_FIELD[e.field]) $(CM_FIELD[e.field]).setAttribute('aria-invalid', 'true'); });
    $('cm-err').textContent = errs.length ? errs[0].msg : '';
    $('cm-save').disabled = errs.length > 0;
    var out = $('cm-total');
    out.textContent = '';
    if (errs.length) return;
    out.appendChild(totalView(cand, false));
    out.appendChild(planTable(C.calcWeek(state.profile.classes, cand, null), -1));
  }

  function showCmResult(res) {
    var box = $('cm-route');
    box.className = 'state-box ' + (res.kind === 'manual' ? 'state-note' : 'state-ok');
    box.textContent = '';
    box.appendChild(icon(res.kind === 'manual' ? 'info' : 'check'));
    box.appendChild(el('div', { className: 'state-body' }, [el('p', { className: 'state-title', text: res.title }), el('p', { text: res.text })]));
    if (res.minutes) $('cm-travel').value = res.minutes;
    show('cm-result', true);
    setSteps('#cm-steps li', 2);
    updateCmPreview();
    if (!res.minutes) $('cm-travel').focus();
  }

  $('cm-calc').addEventListener('click', function () {
    var btn = this;
    var from = $('cm-from').value.trim(), to = $('cm-to').value.trim() || '영남대';
    $('cm-form-err').textContent = '';
    if (!from) {
      $('cm-form-err').textContent = '출발지를 입력해 주세요 (가까운 역 · 정류장 이름).';
      $('cm-from').setAttribute('aria-invalid', 'true');
      $('cm-from').focus();
      return;
    }
    $('cm-from').removeAttribute('aria-invalid');
    btn.disabled = true;
    show('cm-loading', true);
    show('cm-result', false);
    S.commuteRoute(from, to).then(function (r) {
      return { minutes: Math.round(Number(r.minutes)), kind: 'api', title: '길찾기로 계산했어요' + (r.source ? ' · ' + r.source : ''),
               text: (r.summary || from + ' → ' + to) + (r.transfers ? ' · 환승 ' + r.transfers + '회' : '') };
    }, function (e) {
      if (e.reason !== 'unavailable') return { minutes: null, kind: 'manual', title: '자동 계산을 못 했어요', text: e.message + ' 이동 시간을 직접 넣어 주세요.' };
      var sm = M.subwayMinutes(state.subway, from, to);
      if (sm) {
        return { minutes: sm.minutes, kind: 'subway', title: '대구 2호선 시각표로 계산했어요',
                 text: sm.from + '역 → ' + sm.to + '역 열차 ' + sm.minutes + '분. 역까지 걷는 시간 · 열차 기다리는 시간은 여유 시간에 넣어 주세요.' };
      }
      return { minutes: null, kind: 'manual', title: '이 구간은 아직 자동 계산이 안 돼요',
               text: '길찾기 API 연결 전이에요. 지도 앱에서 확인한 ' + from + ' → ' + to + ' 이동 시간을 넣어 주세요.' };
    }).then(function (res) {
      btn.disabled = false;
      show('cm-loading', false);
      showCmResult(res);
    });
  });

  ['cm-prep', 'cm-buffer', 'cm-travel'].forEach(function (id) {
    $(id).addEventListener('input', function () { if (!$('cm-result').classList.contains('hidden')) updateCmPreview(); });
  });

  $('cm-save').addEventListener('click', function () {
    var cand = cmCandidate();
    setSteps('#cm-steps li', 3);
    var p = S.load() || state.profile;
    p.commute = cand;
    var res = S.save(p);
    if (!res.ok) {
      setSteps('#cm-steps li', 2);
      $('cm-err').textContent = '저장하지 못했어요: ' + res.errors.map(function (e) { return e.msg; }).join(', ');
      return;
    }
    state.profile = res.profile;
    state.cmOpen = false;
    show('commute-form', false);
    render();
    setStatus('ok', '통학 시간을 저장했어요 (총 ' + M.duration(C.totalMin(cand)) + '). 요일별 기상 시각을 단축어 알람에 쓰세요.');
    var code = S.getSyncCode();
    if (code) {
      S.pushRemote(code, res.profile).then(null, function (e) {
        setStatus('warn', '이 기기에는 저장했지만 서버 저장은 실패했어요 (' + e.message + ').');
      });
    }
  });

  $('cm-cancel').addEventListener('click', closeCommuteForm);
  $('cm-open').addEventListener('click', function () { if (state.cmOpen) closeCommuteForm(); else openCommuteForm(); });

  function copyShortcut() {
    if (!state.plan) return;
    copyText(M.shortcutText(state.plan.week, state.plan.commute)).then(function () {
      cmMsg('ok', '요일별 기상 시각을 복사했어요. 단축어 알람을 맞출 때 붙여 넣으세요.');
    }, function () {
      cmMsg('info', '자동 복사가 안 돼요. 위 표를 보고 알람을 맞춰 주세요.');
    });
  }

  function fillStations() {
    var dl = $('cm-stations');
    dl.textContent = '';
    ((state.subway && state.subway.stations) || []).forEach(function (st) { dl.appendChild(el('option', { value: st.name })); });
  }

  /* ---------- 크롬 확장 연결 (부가, 접힘) ----------
   * 확장 팝업은 동기화 코드로 서버(api/profile/<코드>)의 시간표를 읽는다 → 여기서는 코드를 만들어 보여 주기만 한다.
   * 코드 만들기 = 설정 화면 "동기화 코드 만들기"와 같은 순서 (겹침 확인 → 서버 저장 → 이 기기에 코드 기록). */
  function renderExt() {
    var code = S.getSyncCode();
    var demo = state.mode === 'demo';
    show('ext-card', isLive());   // 체험 모드: 확장 받기 + 팝업 "예시 데이터로 보기" 안내 (코드는 내 시간표가 있어야 만듦)
    show('ext-demo', demo);
    show('ext-nocode', !demo && !code);
    show('ext-hascode', !demo && !!code);
    $('ext-code').textContent = code || '';
  }

  function extMsg(kind, msg) {
    var m = $('ext-msg');
    m.className = 'notice small' + (kind ? ' notice-' + kind : '') + (msg ? '' : ' hidden');
    m.textContent = msg || '';
  }

  /** 클립보드 복사: 보안 컨텍스트가 아닌 주소(HTTPS 아님)에서는 navigator.clipboard 가 없어 예전 방식으로.
   *  클립보드 API 가 권한 문제로 거절돼도 예전 방식을 한 번 더 시도한다. */
  function legacyCopy(text) {
    var ta = el('textarea', { readonly: '', 'aria-hidden': 'true' });
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(null, function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  $('ext-make').addEventListener('click', function () {
    var btn = this;
    if (!state.profile) return;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = '만드는 중…';
    extMsg('', '');
    var code = S.makeSyncCode();
    S.pullRemote(code).then(function (existing) {
      if (existing) code = S.makeSyncCode();          // 아주 드물게 겹치면 한 번 더 만든다
      return S.pushRemote(code, state.profile);
    }).then(function () {
      S.setSyncCode(code);
      renderExt();
      extMsg('ok', '코드를 만들고 시간표를 서버에 저장했어요. 확장 프로그램에 이 코드를 넣어 주세요.');
    }, function (e) {
      extMsg('err', '코드를 만들지 못했어요 (' + e.message + '). 잠시 뒤 다시 눌러 주세요.');
    }).then(function () {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.textContent = '동기화 코드 만들기';
    });
  });

  $('ext-copy').addEventListener('click', function () {
    var code = S.getSyncCode();
    if (!code) return;
    copyText(code).then(function () {
      extMsg('ok', '코드를 복사했어요.');
    }, function () {
      var r = document.createRange();                 // 자동 복사가 막히면 코드를 선택해 둔다
      r.selectNodeContents($('ext-code'));
      var sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      extMsg('info', '자동 복사가 안 돼요. 선택된 코드를 직접 복사해 주세요.');
    });
  });

  /* ---------- 10분 전 배너 ---------- */
  function updateBanner(classes, now) {
    if (!isLive()) { hideBanner(); return; }
    var nowSec = W.secOfDay(now);
    var today = W.dateKey(now);
    if (state.active) {
      var left = T.toMin(state.active.cls.start) * 60 - nowSec;
      if (state.active.date !== today || left <= 0) { hideBanner(); }
      else { paintBanner(state.active.cls, left); return; }
    }
    var prefix = state.mode === 'demo' ? 'demo:' : '';
    var rec = W.alertedForToday(S.getAlerted(), now);
    var t = W.alertTarget(classes, now, rec.keys, prefix);
    if (!t) return;
    rec.keys.push(t.key);                    // 당일 한 번만: 처음 띄울 때 기록
    S.setAlerted(rec);
    state.active = { cls: t.cls, key: t.key, date: today };
    paintBanner(t.cls, t.secondsLeft);
  }

  function paintBanner(c, left) {
    $('alert-name').textContent = c.name || '수업';
    $('alert-room').textContent = c.room ? '· ' + c.room : '';
    $('alert-left').textContent = W.shortLeft(left);
    show('alert-banner', true);
    document.body.classList.add('has-alert');
    document.title = '🔔 ' + Math.ceil(left / 60) + '분 뒤 ' + (c.name || '수업') + ' — ' + BASE_TITLE;
  }

  function hideBanner() {
    state.active = null;
    show('alert-banner', false);
    document.body.classList.remove('has-alert');
    document.title = BASE_TITLE;
  }

  /* ---------- 매초 ---------- */
  function tick() {
    var now = clock();
    $('today-date').textContent = (now.getMonth() + 1) + '월 ' + now.getDate() + '일 (' + DAY_NAME[now.getDay()] + ') ' + T.toClock(T.nowMin(now)).text;
    if (state.mode === 'loading') return;
    if (state.renderedDate && state.renderedDate !== W.dateKey(now)) { render(); return; }   // 날짜가 바뀌면 다시 그림
    var classes = currentClasses(now);
    if (isLive()) {
      renderNext(classes, now);
      renderToday(classes, now);
    }
    updateWeekLive(classes, now);
    updateBanner(classes, now);
  }

  /* ---------- 예시 체험 ---------- */
  function startDemo() {
    var now = clock();
    var d = S.getDemo();
    if (!d || d.date !== W.dateKey(now)) S.setDemo({ date: W.dateKey(now), extra: [] });
    state.mode = 'demo';
    closeRegister();
    hideBanner();
    render();
    setStatus('info', '예시 시간표로 체험 중이에요. "알림 바로 확인"을 누르면 10분 전 알림을 볼 수 있어요.');
  }

  /** N분 뒤 시작하는 체험 수업 추가 → 바로 10분 전 배너 (plan.md A-4) */
  function addDemoClass(minutes) {
    var now = clock();
    var startMin = Math.floor((W.secOfDay(now) + minutes * 60) / 60);
    if (startMin > 23 * 60 + 58) {
      setStatus('warn', '자정 직전에는 체험 수업을 만들 수 없어요. 잠시 뒤 다시 시도해 주세요.');
      return;
    }
    var endMin = Math.min(startMin + 50, 23 * 60 + 59);
    var d = S.getDemo();
    if (!d || d.date !== W.dateKey(now)) d = { date: W.dateKey(now), extra: [] };
    d.extra.push({
      id: 'demo' + Date.now().toString(36),
      name: DEMO_NAME, day: now.getDay(),
      start: T.toClock(startMin).text, end: T.toClock(endMin).text, room: '체험 강의실'
    });
    S.setDemo(d);
    if (state.mode !== 'demo') startDemo();
    hideBanner();
    renderWeek(now);
    renderCommute();
    tick();
    setStatus('info', '오늘 ' + T.toClock(startMin).text + '에 시작하는 체험 수업을 추가했어요. 카운트다운 위 주황 배너가 10분 전 알림이에요.');
  }

  function endDemo() {
    S.clearDemo();
    hideBanner();
    state.mode = state.profile && state.profile.classes.length ? 'mine' : 'first';
    render();
    setStatus('', '');
  }

  /* ---------- 에타 시간표 등록: 링크 입력 → 가져오는 중 → 실패 / 수업 확인 → 저장 ---------- */
  function setStep(n) { setSteps('#import-steps li', n); }
  function setSteps(sel, n) {
    [].forEach.call(document.querySelectorAll(sel), function (li) {
      var s = Number(li.getAttribute('data-step'));
      li.classList.toggle('is-active', s === n);
      li.classList.toggle('is-done', s < n);
      if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }

  function setLoading(on) {
    var btn = $('import-go');
    btn.disabled = on;
    btn.classList.toggle('is-loading', on);
    btn.textContent = on ? '가져오는 중…' : '가져오기';
    $('import-url').readOnly = on;
    show('import-loading', on);
  }

  function openRegister() {
    show('register', true);
    showImportError('');
    show('import-preview', false);
    show('import-form', true);
    setStep(1);
    $('register').scrollIntoView({ block: 'start' });
    $('import-url').focus();
  }

  function closeRegister() {
    show('register', false);
    state.imported = null;
  }

  function showImportError(msg) {
    $('import-error-msg').textContent = msg || '';
    show('import-error', !!msg);
    if (msg) $('import-url').setAttribute('aria-invalid', 'true');
    else $('import-url').removeAttribute('aria-invalid');
  }

  function renderPreview(r) {
    var list = $('preview-list');
    list.textContent = '';
    r.classes.forEach(function (c) {
      list.appendChild(el('li', {}, [
        el('span', { className: 'd', text: DAY_NAME[c.day] }),
        el('span', { className: 't', text: c.start + '–' + c.end }),
        el('span', { className: 'n', text: c.name }),
        el('span', { className: 'r', text: c.room || '강의실 정보 없음' })
      ]));
    });
    $('preview-summary').textContent = (r.year ? r.year + '년 ' + r.semester + '학기 · ' : '') + '수업 ' + r.classes.length + '개를 가져왔어요. 확인 후 저장해 주세요.';
    var notes = [];
    if (r.skipped && r.skipped.length) notes.push('시간이 없는 과목 ' + r.skipped.length + '개는 제외했어요: ' + r.skipped.join(', '));
    (r.warnings || []).forEach(function (w) { notes.push(w); });
    var problems = C.validateClasses(r.classes);
    if (problems.length) notes.push('겹치는 수업이 있어 저장할 수 없어요. 에타에서 정리하거나 설정 화면에서 직접 고쳐 주세요.');
    var box = $('preview-notes');
    box.textContent = notes.join(' / ');
    box.className = 'notice small ' + (problems.length ? 'notice-err' : 'notice-neutral') + (notes.length ? '' : ' hidden');
    $('import-save').disabled = problems.length > 0;
    $('import-save').textContent = state.profile && state.profile.classes.length ? '시간표 저장 (기존 시간표 교체)' : '시간표 저장';
    show('import-form', false);
    show('import-preview', true);
    setStep(2);
    $('import-save').focus();
  }

  $('import-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if ($('import-go').disabled) return;
    var url = $('import-url').value.trim();
    showImportError('');
    if (!url) { showImportError('에타 시간표 공유 링크(https://everytime.kr/@…)를 붙여 주세요.'); $('import-url').focus(); return; }
    if (typeof S.importEverytime !== 'function') {   // 예전 storage.js 가 브라우저에 남아 있을 때
      showImportError('화면 파일이 예전 버전이에요. 새로고침(Ctrl+F5 · 휴대폰은 당겨서 새로고침)한 뒤 다시 시도해 주세요.');
      return;
    }
    setLoading(true);
    S.importEverytime(url).then(function (r) {
      state.imported = r;
      setLoading(false);
      renderPreview(r);
    }, function (e) {
      setLoading(false);
      showImportError(e.message);
      $('import-url').focus();
    });
  });

  $('import-save').addEventListener('click', function () {
    var r = state.imported;
    if (!r) return;
    setStep(3);
    var res = S.replaceClasses(r.classes);
    if (!res.ok) {
      setStep(2);
      setStatus('err', '저장하지 못했어요: ' + res.errors.map(function (e) { return e.msg; }).join(', '));
      return;
    }
    S.clearDemo();
    state.profile = res.profile;
    state.mode = 'mine';
    closeRegister();
    hideBanner();
    render();
    window.scrollTo(0, 0);
    setStatus('ok', '시간표를 저장했어요 (수업 ' + r.classes.length + '개). 다음에 열어도 이 시간표가 바로 보여요.');
    var card = $('next-card');
    card.classList.remove('card-flash');
    void card.offsetWidth;                    // 저장 직후 다음 수업 카드를 한 번 강조
    card.classList.add('card-flash');
    var code = S.getSyncCode();
    if (code) {
      S.pushRemote(code, res.profile).then(null, function (e) {
        setStatus('warn', '이 기기에는 저장했지만 서버 저장은 실패했어요 (' + e.message + ').');
      });
    }
  });

  $('import-retry').addEventListener('click', function () {
    state.imported = null;
    show('import-preview', false);
    show('import-form', true);
    setStep(1);
    $('import-url').select();
  });
  $('import-cancel').addEventListener('click', closeRegister);
  $('btn-register').addEventListener('click', openRegister);

  document.addEventListener('click', function (ev) {
    if (ev.target.closest('#cm-copy')) { copyShortcut(); return; }
    var a = ev.target.closest('[data-action]');
    if (!a) return;
    if (a.getAttribute('data-action') === 'demo') startDemo();
    if (a.getAttribute('data-action') === 'register') openRegister();
    if (a.getAttribute('data-action') === 'commute') openCommuteForm();
  });
  $('demo-alert').addEventListener('click', function () { addDemoClass(9); });
  $('demo-end').addEventListener('click', endDemo);
  $('alert-close').addEventListener('click', hideBanner);

  /* ---------- 시작 ---------- */
  function demoParam() {
    var m = /[?&]demo=(\d{1,2})(?:&|$)/.exec(location.search);
    var n = m ? Number(m[1]) : 0;
    return n >= 1 && n <= 10 ? n : 0;
  }

  function start() {
    Promise.all([
      S.loadSample().then(null, function () { return null; }),
      S.loadSynced(),
      S.loadSubway().then(null, function () { return null; })
    ]).then(function (res) {
      state.subway = res[2];
      fillStations();
      state.sample = res[0] || { classes: [], commute: null };
      state.profile = res[1].profile && res[1].profile.classes.length ? res[1].profile : null;
      if (res[1].warning) setStatus('warn', res[1].warning);
      var n = demoParam();
      if (n) {
        try { history.replaceState(null, '', location.pathname); } catch (e) { /* 무시 */ }
        state.mode = 'demo';
        render();
        addDemoClass(n);
        return;
      }
      if (S.getDemo()) state.mode = 'demo';
      else state.mode = state.profile ? 'mine' : 'first';
      render();
    });
  }

  // 다른 탭(설정 화면)에서 저장하면 다시 불러온다
  window.addEventListener('storage', function (e) {
    if (e.key === S.KEY) {
      var p = S.load();
      state.profile = p && p.classes.length ? p : null;
      if (state.mode !== 'demo') state.mode = state.profile ? 'mine' : 'first';
      render();
    }
    if (e.key === 'wakeup.sync') renderExt();   // 설정 화면에서 코드를 만들거나 해제하면 바로 반영
  });

  window.WakeDashboard = {                // 테스트용
    state: state, tick: tick, render: render,
    setClock: function (fn) { clockFn = fn; }
  };
  tick();
  setInterval(tick, 1000);
  start();
})();
