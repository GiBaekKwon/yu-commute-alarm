const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const site = process.argv[2] || require('path').join(__dirname, '..', 'site');
const tick = () => new Promise(r => setTimeout(r, 20));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `\n     기대 ${JSON.stringify(expected)}\n     실제 ${JSON.stringify(actual)}`));
}

function open(storage) {
  const html = fs.readFileSync(path.join(site, 'setup.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const dom = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ''), {
    url: 'http://localhost/wakeup/setup.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  if (storage) for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.fetch = async (url) => {
    const p = path.join(site, url);
    if (!p.startsWith(site) || !fs.existsSync(p)) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
  };
  w.confirm = () => true;
  const errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  for (const s of srcs) w.eval(fs.readFileSync(path.join(site, s.split('?')[0]), 'utf8'));
  return { w, d: w.document, errors };
}
const submit = (d, w) => d.getElementById('setup-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
const rows = d => [...d.querySelectorAll('.class-item')];
const setVal = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };

(async () => {
  let { w, d, errors } = open();
  await tick();
  check('처음: 수업 없음 안내', !!d.getElementById('class-empty'), true);
  check('카드 2개: 시간표 · 동기화 (11/21 통학 · 버스 · 전날 밤 알림 카드 없앰)', [...d.querySelectorAll('section.card h2')].map(h => h.textContent).filter(t => /^\d\./.test(t)),
    ['1. 수업 시간표 (직접 편집)', '2. 다른 기기와 함께 쓰기 (선택)']);
  check('전날 밤 알림 입력칸 없음', ['notify-enabled', 'notify-topic', 'notify-sendAt', 'notify-random'].filter(id => d.getElementById(id)), []);
  check('통학 · 버스 입력칸 없음', ['prepMin', 'walkToStopMin', 'walkToRoomMin', 'bufferMin', 'routeId', 'c-rideMin', 'commute-travel'].filter(id => d.getElementById(id)), []);
  check('하단 탭 2개, 설정이 현재 탭', [...d.querySelectorAll('.tabbar a')].map(a => a.textContent + (a.getAttribute('aria-current') ? '*' : '')), ['대시보드', '설정*']);
  const fieldNames = [...d.querySelectorAll('input,select,textarea')].map(e => (e.id || '') + (e.dataset.field || ''));
  check('개인정보 입력칸 없음 (주소 · 이름 · 학번 · 전화)', fieldNames.filter(n => /addr|address|phone|student|lat|lng|주소/i.test(n)), []);

  d.getElementById('load-sample').click(); await tick();
  check('예시 불러오기: 수업 6개', rows(d).length, 6);
  check('불러오기만 하면 저장 안 됨', w.localStorage.getItem('wakeup.v1'), null);

  submit(d, w); await tick();
  check('저장 성공 메시지', d.getElementById('status').className, 'notice notice-ok');
  const saved = JSON.parse(w.localStorage.getItem('wakeup.v1'));
  check('저장된 수업 6개 · 예시 통학 정보(노선 route-a)도 함께 저장', [saved.classes.length, saved.commute.routeId], [6, 'route-a']);
  const prev = [...d.querySelectorAll('#preview li')].map(li => li.textContent);
  check('미리보기: 월~금 5줄 (주말 수업 없으면 생략)', prev.length, 5);
  check('미리보기 월요일', prev[0], '월07:20 기상 · 08:05 버스');
  check('미리보기 금요일', prev[4], '금수업 없음');

  // 오류
  const r0 = rows(d)[0];
  r0.querySelector('[data-field="end"]').value = '08:00';
  submit(d, w); await tick();
  check('잘못된 입력: 오류 메시지', d.getElementById('status').textContent, '입력을 확인해 주세요 (1곳).');
  check('잘못된 칸 빨간 표시', r0.querySelector('[data-field="end"]').getAttribute('aria-invalid'), 'true');
  check('칸 아래 안내문', r0.querySelector('[data-err-row]').textContent, '종료: 종료 시각이 시작 시각보다 늦어야 해요');
  check('오류면 기존 저장본 그대로', JSON.parse(w.localStorage.getItem('wakeup.v1')).classes[0].end, '10:15');
  r0.querySelector('[data-field="end"]').value = '10:15';

  // 겹침
  d.getElementById('add-class').click();
  const nr = rows(d).at(-1);
  nr.querySelector('[data-field="name"]').value = '겹치는수업';
  nr.querySelector('[data-field="start"]').value = '09:30';
  nr.querySelector('[data-field="end"]').value = '10:30';
  submit(d, w); await tick();
  check('같은 요일 겹침 거부', d.getElementById('status').className, 'notice notice-err');
  nr.querySelector('[data-action="remove"]').click();

  // 새로 열기 → 저장본 표시
  const store = { 'wakeup.v1': w.localStorage.getItem('wakeup.v1') };
  let errors2; ({ w, d, errors: errors2 } = open(store)); await tick();
  check('다시 열면 저장본 표시', rows(d).length, 6);
  check('다시 열면 미리보기 표시', d.getElementById('preview-card').classList.contains('hidden'), false);

  // 수업 모두 삭제 → 저장 막기
  rows(d).forEach(r => r.querySelector('[data-action="remove"]').click());
  check('모두 삭제하면 안내 다시 표시', !!d.getElementById('class-empty'), true);
  submit(d, w); await tick();
  check('수업 0개 저장 막기', d.getElementById('status').textContent, '수업을 하나 이상 추가해 주세요.');

  // 통학 정보 없는 저장본: 수업만 고쳐 저장해도 null 그대로
  const noCm = JSON.parse(store['wakeup.v1']); noCm.commute = null;
  ({ w, d, errors: errors2 } = open({ 'wakeup.v1': JSON.stringify(noCm) })); await tick();
  rows(d)[0].querySelector('[data-field="name"]').value = '자료구조(수정)';
  submit(d, w); await tick();
  const s3 = JSON.parse(w.localStorage.getItem('wakeup.v1'));
  check('통학 정보 없음(null) 저장본 → 수업만 바뀌고 null 유지', [d.getElementById('status').className, s3.classes[0].name, s3.commute], ['notice notice-ok', '자료구조(수정)', null]);
  check('통학 정보 없으면 기상 미리보기 숨김', d.getElementById('preview-card').classList.contains('hidden'), true);

  d.getElementById('clear-all').click(); await tick();
  check('모두 지우기', w.localStorage.getItem('wakeup.v1'), null);

  // 11/21 대시보드 "통학 시간 계산"(이동 시간 방식)으로 저장한 프로필
  const trvProfile = { version: 1, classes: [{ id: 'a', name: '자료구조', day: 1, start: '09:00', end: '10:15', room: '' }],
    commute: { prepMin: 40, travelMin: 37, bufferMin: 10 }, notify: { enabled: false, channel: 'ntfy', topic: '', sendAt: '21:00' } };
  const o4 = open({ 'wakeup.v1': JSON.stringify(trvProfile) }); await tick();
  const d4 = o4.d;
  rows(d4)[0].querySelector('[data-field="name"]').value = '자료구조(수정)';
  submit(d4, o4.w); await tick();
  const s4 = JSON.parse(o4.w.localStorage.getItem('wakeup.v1'));
  check('이동 시간 방식: 수업만 고쳐 저장해도 통학 정보 그대로', [d4.getElementById('status').className, s4.classes[0].name, s4.commute], ['notice notice-ok', '자료구조(수정)', { prepMin: 40, travelMin: 37, bufferMin: 10 }]);
  check('이동 시간 방식: 저장된 기상 시각 미리보기 (월 07:33 기상 · 08:13 출발)', d4.querySelector('#preview li').textContent, '월07:33 기상 · 08:13 출발');
  check('스크립트 오류 없음 (이동 시간 방식)', o4.errors, []);

  // 11/21 버그: "10시 7분"이 밤 10시(22:07)로 저장됨 → 24시간제 글자 칸
  const o5 = open({ 'wakeup.v1': JSON.stringify({ ...trvProfile, classes: [{ id: 'p', name: '저녁수업', day: 2, start: '18:50', end: '20:05', room: '' }] }) }); await tick();
  const d5 = o5.d, r5 = rows(d5)[0];
  check('시각 칸은 오전/오후 칸이 있는 type=time 이 아님 (수업 시작 · 종료)', [r5.querySelector('[data-field="start"]').type, r5.querySelector('[data-field="end"]').type], ['text', 'text']);
  const st5 = r5.querySelector('[data-field="start"]'), en5 = r5.querySelector('[data-field="end"]');
  st5.value = '10시 7분'; en5.value = '1130';
  st5.dispatchEvent(new o5.w.FocusEvent('focusout', { bubbles: true }));
  check('칸을 벗어나면 "10시 7분" → "10:07" 로 정리', st5.value, '10:07');
  submit(d5, o5.w); await tick();
  const s5 = JSON.parse(o5.w.localStorage.getItem('wakeup.v1'));
  check('오후 수업(18:50)을 10시 7분으로 고쳐 저장 → 10:07 (22:07 아님) · 종료 "1130" → 11:30', [d5.getElementById('status').className, s5.classes[0].start, s5.classes[0].end], ['notice notice-ok', '10:07', '11:30']);
  const st5b = () => rows(d5)[0].querySelector('[data-field="start"]');   // 저장하면 다시 그려지므로 매번 새로 찾는다
  st5b().value = '오후 10:07'; rows(d5)[0].querySelector('[data-field="end"]').value = '오후 11시'; submit(d5, o5.w); await tick();
  check('"오후"를 직접 쓰면 22:07 · "오후 11시" → 23:00', [JSON.parse(o5.w.localStorage.getItem('wakeup.v1')).classes[0].start, JSON.parse(o5.w.localStorage.getItem('wakeup.v1')).classes[0].end], ['22:07', '23:00']);
  st5b().value = '25:00'; submit(d5, o5.w); await tick();
  check('못 알아듣는 시각 → 저장 막고 칸 표시', [d5.getElementById('status').className, st5b().getAttribute('aria-invalid'), JSON.parse(o5.w.localStorage.getItem('wakeup.v1')).classes[0].start], ['notice notice-err', 'true', '22:07']);
  check('스크립트 오류 없음 (시각 칸)', o5.errors, []);
  const nOn = { enabled: true, channel: 'ntfy', topic: 'wakeup-test123', sendAt: '22:30' };
  const o6 = open({ 'wakeup.v1': JSON.stringify({ ...trvProfile, notify: nOn }) }); await tick();
  rows(o6.d)[0].querySelector('[data-field="name"]').value = '알림유지';
  submit(o6.d, o6.w); await tick();
  check('알림 설정이 있던 저장본 → 수업만 고쳐 저장해도 notify 그대로', [o6.d.getElementById('status').className, JSON.parse(o6.w.localStorage.getItem('wakeup.v1')).notify], ['notice notice-ok', nOn]);

  check('스크립트 오류 없음', errors.concat(errors2 || []), []);
  console.log(`==> ${pass} / ${pass + fail} PASS ${fail ? '❌' : '✅'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
