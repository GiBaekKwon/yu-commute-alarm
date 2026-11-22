/*
 * setup.js — 등록 화면 (setup.html)
 * time.js · calc.js · storage.js · bus.js 를 먼저 불러와야 한다.
 * 화면 값 → 프로필(plan.md 2-1) → WakeStorage.save() 로 검사 · 저장.
 * 11/21: 통학 입력(버스 시간표 방식 칸 · 노선 선택)은 없앴다 → 통학 시간은 대시보드 "통학 시간 계산"에서 정한다.
 *        여기서는 불러온 commute 를 그대로 보관했다가 저장할 때 그대로 넣는다 (옛 버스 방식 프로필도 유지).
 * 11/21: 전날 밤 알림(ntfy) 카드도 없앴다 (대시보드 아이폰 단축어 알람으로 대체). notify 도 불러온 값을 그대로 저장한다
 *        → 프로필 형식(plan.md 2-1)은 그대로라 서버 · 크롬 확장은 영향 없음.
 */
(function () {
  'use strict';

  var T = window.WakeTime, C = window.WakeCalc, S = window.WakeStorage, B = window.WakeBus;

  var DAYS = [   // 화면 순서: 월 ~ 일
    { v: 1, t: '월' }, { v: 2, t: '화' }, { v: 3, t: '수' }, { v: 4, t: '목' },
    { v: 5, t: '금' }, { v: 6, t: '토' }, { v: 0, t: '일' }
  ];
  var DAY_NAME = ['일', '월', '화', '수', '목', '금', '토'];

  var $ = function (id) { return document.getElementById(id); };
  var form = $('setup-form');
  var listEl = $('class-list');
  var statusEl = $('status');

  var keptCommute = null;   // 불러온 통학 정보 (화면에서 고치지 않고 그대로 저장)
  var keptNotify = null;    // 불러온 알림 설정 (화면 없음, 그대로 저장)

  /* ---------- 작은 도우미 ---------- */
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'className') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function setStatus(kind, msg) {
    statusEl.className = 'notice' + (kind ? ' notice-' + kind : '');
    statusEl.textContent = msg || '';
  }

  /* ---------- 시각 칸 (11/21 버그 수정) ----------
   * 브라우저 시각 칸(type=time)은 한국어에서 오전/오후 칸이 따로 있어 "10시 7분"이 오후 그대로 22:07 로 저장됐다.
   * → 24시간제 글자 칸(data-clock) + WakeTime.parseClock. 알아들으면 "HH:MM" 으로, 못 알아들으면 친 그대로 둬서 검사에 걸리게. */
  function clock(text) {
    var hhmm = T.parseClock(text);
    return hhmm === null ? String(text).trim() : hhmm;
  }

  /* ---------- 수업 카드 ---------- */
  function classRow(c) {
    var id = c.id || S.newClassId();
    var daySel = el('select', { 'data-field': 'day', 'aria-label': '요일' });
    DAYS.forEach(function (d) {
      var o = el('option', { value: String(d.v), text: d.t + '요일' });
      if (Number(c.day) === d.v) o.selected = true;
      daySel.appendChild(o);
    });

    function input(field, type, label, value, extra) {
      var attrs = { type: type, 'data-field': field, 'aria-label': label };
      Object.keys(extra || {}).forEach(function (k) { attrs[k] = extra[k]; });
      var i = el('input', attrs);
      i.value = value || '';
      return el('label', { className: 'field' }, [
        el('span', { text: label }), i
      ]);
    }

    var row = el('div', { className: 'class-item', 'data-id': id }, [
      el('div', { className: 'grid2' }, [
        el('label', { className: 'field' }, [el('span', { text: '요일' }), daySel]),
        input('name', 'text', '과목', c.name, { maxlength: '40', placeholder: '자료구조', autocomplete: 'off' }),
        input('start', 'text', '시작', c.start, { inputmode: 'text', autocomplete: 'off', maxlength: '12', placeholder: '09:00', 'data-clock': '1' }),
        input('end', 'text', '종료', c.end, { inputmode: 'text', autocomplete: 'off', maxlength: '12', placeholder: '10:15', 'data-clock': '1' }),
        input('room', 'text', '강의실 (선택)', c.room, { maxlength: '40', placeholder: '공학관 302호', autocomplete: 'off' }),
        el('div', { className: 'field class-actions' }, [
          el('span', { text: ' ', 'aria-hidden': 'true' }),
          el('button', { type: 'button', className: 'btn btn-danger', 'data-action': 'remove', text: '삭제' })
        ]),
        el('small', { className: 'err span2', 'data-err-row': id })
      ])
    ]);
    return row;
  }

  function renderClasses(classes) {
    listEl.textContent = '';
    if (!classes.length) {
      listEl.appendChild(el('p', { className: 'empty', id: 'class-empty', text: '아직 수업이 없어요. 아래 버튼으로 추가해 주세요.' }));
      return;
    }
    classes.forEach(function (c) { listEl.appendChild(classRow(c)); });
  }

  function addClass() {
    var empty = $('class-empty');
    if (empty) empty.remove();
    var row = classRow({ day: 1, start: '09:00', end: '10:15', name: '', room: '' });
    listEl.appendChild(row);
    row.querySelector('[data-field="name"]').focus();
  }

  /* ---------- 화면 ↔ 프로필 ---------- */
  function fillForm(p) {
    keptNotify = p.notify || S.emptyProfile().notify;
    renderClasses(p.classes);
    keptCommute = p.commute || null;
  }

  function readForm() {
    var classes = Array.prototype.map.call(listEl.querySelectorAll('.class-item'), function (row) {
      function v(f) { return row.querySelector('[data-field="' + f + '"]').value; }
      return { id: row.getAttribute('data-id'), name: v('name'), day: Number(v('day')),
               start: clock(v('start')), end: clock(v('end')), room: v('room') };
    });
    // 요일(월→일) · 시작 시각 순으로 정리해서 저장
    var order = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
    classes.sort(function (a, b) {
      return (order[a.day] - order[b.day]) || ((T.toMin(a.start) || 0) - (T.toMin(b.start) || 0));
    });

    return { version: 1, classes: classes, commute: keptCommute, notify: keptNotify };
  }

  /* ---------- 오류 표시 ---------- */
  function clearErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (e) { e.removeAttribute('aria-invalid'); });
    Array.prototype.forEach.call(form.querySelectorAll('.err'), function (e) { e.textContent = ''; });
  }

  function showErrors(errors) {
    var first = null;
    errors.forEach(function (e) {
      var input = null, box = null;
      if (e.scope === 'classes') {
        var row = Array.prototype.filter.call(listEl.querySelectorAll('.class-item'), function (r) {
          return r.getAttribute('data-id') === e.id;
        })[0];
        if (row) {
          input = row.querySelector('[data-field="' + e.field + '"]');
          box = row.querySelector('[data-err-row]');
          var label = { day: '요일', start: '시작', end: '종료' }[e.field] || '';
          var line = (label ? label + ': ' : '') + e.msg;
          box.textContent = box.textContent ? box.textContent + ' · ' + line : line;
        }
      }
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        if (!first) first = input;
      }
      if (box && e.scope !== 'classes' && !box.textContent) box.textContent = e.msg;
    });
    if (first) first.focus();
  }

  /* ---------- 저장 결과 미리보기 ---------- */
  function renderPreview(p) {
    var card = $('preview-card'), ul = $('preview');
    if (!p.commute) { card.classList.add('hidden'); return; }
    B.resolveRoute(p.commute).then(function (route) {
      var week = C.calcWeek(p.classes, p.commute, route);
      ul.textContent = '';
      DAYS.forEach(function (d) {
        var r = week[d.v];
        if (r.status === 'no-class' && (d.v === 0 || d.v === 6)) return;   // 주말은 수업 있을 때만
        var right;
        if (r.status === 'no-class') right = '수업 없음';
        else if (r.status === 'no-bus') right = '이 요일 버스 없음';
        else if (C.isTravelMode(p.commute)) right = T.label(r.wake) + ' 기상 · ' + T.label(r.departure) + ' 출발';
        else {
          right = T.label(r.wake) + ' 기상 · ' + T.label(r.bus) + ' 버스';
          if (r.status === 'late') right += ' (약 ' + r.lateMin + '분 지각)';
        }
        ul.appendChild(el('li', {}, [el('span', { text: d.t }), el('strong', { text: right })]));
      });
      card.classList.remove('hidden');
    }, function () {
      card.classList.add('hidden');
    });
  }

  /* ---------- 이벤트 ---------- */
  $('add-class').addEventListener('click', addClass);
  form.addEventListener('focusout', function (ev) {   // 칸을 벗어나면 "1007" · "10시 7분" → "10:07" 로 정리해서 보여 준다
    var t = ev.target;
    if (t && t.getAttribute && t.getAttribute('data-clock')) {
      var hhmm = T.parseClock(t.value);
      if (hhmm) t.value = hhmm;
    }
  });

  listEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-action="remove"]');
    if (!btn) return;
    btn.closest('.class-item').remove();
    if (!listEl.querySelector('.class-item')) renderClasses([]);
  });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    clearErrors();
    var p = readForm();
    if (!p.classes.length) {
      setStatus('err', '수업을 하나 이상 추가해 주세요.');
      $('add-class').focus();
      return;
    }
    var res = S.save(p);
    if (!res.ok) {
      var storageErr = res.errors.filter(function (e) { return e.scope === 'storage'; })[0];
      var commuteErr = res.errors.some(function (e) { return e.scope === 'commute' || e.scope === 'route'; });
      var notifyErr = res.errors.some(function (e) { return e.scope === 'notify'; });
      setStatus('err', storageErr ? storageErr.msg
        : commuteErr ? '저장된 통학 정보가 올바르지 않아요. 대시보드 "통학 시간 계산"에서 다시 정해 주세요.'
        : notifyErr ? '저장된 알림 설정이 올바르지 않아요. "모두 지우기" 후 다시 등록해 주세요.'
        : '입력을 확인해 주세요 (' + res.errors.length + '곳).');
      showErrors(res.errors);
      return;
    }
    fillForm(res.profile);   // 정리된 값(정렬 · 시각 형식)으로 다시 표시
    renderPreview(res.profile);
    var code = S.getSyncCode();
    if (!code) {
      setStatus('ok', '저장했어요. 이 브라우저에 저장되며, 오늘 · 주간 화면에서 볼 수 있어요.');
      return;
    }
    setStatus('info', '이 기기에 저장했어요. 서버에 저장하는 중…');
    S.pushRemote(code, res.profile).then(function () {
      setStatus('ok', '저장했어요. 서버에도 저장돼서 같은 코드(' + code + ')를 쓰는 기기에서 볼 수 있어요.');
    }, function (e) {
      setStatus('warn', '이 기기에는 저장했지만 서버 저장은 실패했어요 (' + e.message + '). 잠시 뒤 다시 저장해 주세요.');
    });
  });

  /* ---------- 동기화 코드 (2단계) ---------- */
  function renderSync() {
    var code = S.getSyncCode();
    $('sync-on').classList.toggle('hidden', !code);
    $('sync-off-box').classList.toggle('hidden', !!code);
    $('sync-code').textContent = code || '';
  }

  function syncError(msg) {
    var box = form.querySelector('[data-err="sync"]');
    box.textContent = msg || '';
    if (msg) $('sync-input').setAttribute('aria-invalid', 'true');
    else $('sync-input').removeAttribute('aria-invalid');
  }

  $('sync-make').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    var code = S.makeSyncCode();
    S.pullRemote(code).then(function (existing) {
      if (existing) code = S.makeSyncCode();          // 아주 드물게 겹치면 한 번 더 만든다
      var saved = S.load();
      return (saved ? S.pushRemote(code, saved) : Promise.resolve()).then(function () {
        S.setSyncCode(code);
        renderSync();
        setStatus('ok', saved
          ? '동기화 코드를 만들고 서버에 저장했어요. 다른 기기에서 ' + code + ' 를 입력해 주세요.'
          : '동기화 코드를 만들었어요. 시간표를 저장하면 서버에도 저장돼요.');
      });
    }).catch(function (e) {
      setStatus('err', '동기화 코드를 만들지 못했어요: ' + e.message);
    }).then(function () { btn.disabled = false; });
  });

  $('sync-load').addEventListener('click', function () {
    var btn = this;
    var code = $('sync-input').value.trim().toLowerCase();
    syncError('');
    if (!S.isValidCode(code)) { syncError('코드는 영문 소문자 · 숫자 8자리예요'); $('sync-input').focus(); return; }
    btn.disabled = true;
    S.pullRemote(code).then(function (p) {
      if (!p) { syncError('이 코드로 저장된 시간표가 없어요'); return; }
      S.saveLocalOnly(p);
      S.setSyncCode(code);
      $('sync-input').value = '';
      clearErrors();
      fillForm(p);
      renderPreview(p);
      renderSync();
      setStatus('ok', '서버에서 시간표를 불러와 이 기기에도 저장했어요.');
    }, function (e) {
      syncError(e.message);
    }).then(function () { btn.disabled = false; });
  });

  $('sync-off').addEventListener('click', function () {
    if (!window.confirm('이 기기에서 동기화 코드를 지울까요? (서버와 이 기기의 시간표는 그대로 남아요)')) return;
    S.clearSyncCode();
    renderSync();
    setStatus('info', '연결을 해제했어요. 이제 이 기기에만 저장돼요.');
  });

  $('load-sample').addEventListener('click', function () {
    S.loadSample().then(function (p) {
      clearErrors();
      fillForm(p);
      setStatus('info', '예시를 불러왔어요. 아직 저장 전이에요 — 고친 뒤 "저장"을 눌러 주세요.');
      $('preview-card').classList.add('hidden');
    }, function (e) {
      setStatus('err', e.message);
    });
  });

  $('clear-all').addEventListener('click', function () {
    if (!window.confirm('이 기기에 저장된 시간표 · 통학 정보 · 동기화 코드를 모두 지울까요? (서버 저장본은 남아요)')) return;
    S.clear();
    S.clearSyncCode();
    clearErrors();
    fillForm(S.emptyProfile());
    renderSync();
    $('preview-card').classList.add('hidden');
    setStatus('info', '이 기기에서 모두 지웠어요.');
  });

  /* ---------- 시작 ---------- */
  var saved = S.load();
  fillForm(saved || S.emptyProfile());
  if (saved) renderPreview(saved);
  renderSync();
  if (S.getSyncCode()) {
    S.loadSynced().then(function (res) {
      if (res.warning) { setStatus('warn', res.warning); return; }
      if (res.source === 'server') {
        fillForm(res.profile);
        renderPreview(res.profile);
      }
    });
  }
})();
