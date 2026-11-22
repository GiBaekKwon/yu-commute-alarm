const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const site = require('path').join(__dirname, '..', 'site'), API = process.argv[2] || 'http://127.0.0.1:5199/api/';
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0, apiDown = false;
const errs = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `\n     기대 ${JSON.stringify(expected)}\n     실제 ${JSON.stringify(actual)}`));
}
// 기기 = localStorage 묶음
function device() { return { store: {} }; }
async function open(dev, page) {
  const html = fs.readFileSync(path.join(site, page), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const dom = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ''), { url: 'http://localhost/wakeup/' + page, runScripts: 'outside-only' });
  const w = dom.window;
  for (const [k, v] of Object.entries(dev.store)) w.localStorage.setItem(k, v);
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = function () {}; w.scrollTo = () => {};
  w.crypto.getRandomValues = a => require('crypto').getRandomValues(a);
  w.fetch = async (url, opts = {}) => {
    if (url.startsWith('api/')) {
      if (apiDown) throw new TypeError('network');
      const { signal, ...rest } = opts;
      const r = await fetch(API + url.slice(4), rest);
      const text = await r.text();
      return { ok: r.ok, status: r.status, json: async () => JSON.parse(text) };
    }
    const p = path.join(site, url);
    if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
  };
  w.addEventListener('error', e => errs.push(page + ': ' + e.message));
  for (const s of srcs) w.eval(fs.readFileSync(path.join(site, s.split('?')[0]), 'utf8'));
  await tick(150);
  const d = w.document;
  return { w, d,
    save() { for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); dev.store[k] = w.localStorage.getItem(k); } for (const k of Object.keys(dev.store)) if (w.localStorage.getItem(k) === null) delete dev.store[k]; w.close(); },
    status: () => d.getElementById('status') && d.getElementById('status').textContent,
    submit: () => d.getElementById('setup-form').dispatchEvent(new w.Event('submit', { cancelable: true })) };
}
const apiGet = async code => { const r = await fetch(API + 'profile/' + code); return [r.status, r.status === 200 ? await r.json() : null]; };

(async () => {
  const A = device(), B = device();
  // 기기 A: 예시 저장 → 코드 만들기
  let a = await open(A, 'setup.html');
  check('A: 처음엔 코드 만들기 칸 보임', [a.d.getElementById('sync-on').classList.contains('hidden'), a.d.getElementById('sync-off-box').classList.contains('hidden')], [true, false]);
  a.d.getElementById('load-sample').click(); await tick();
  a.submit(); await tick();
  check('A: 코드 없을 때 저장 → 이 기기만', a.status().startsWith('저장했어요. 이 브라우저에'), true);
  a.d.getElementById('sync-make').click(); await tick(300);
  const code = a.w.localStorage.getItem('wakeup.sync');
  check('A: 코드 생성 (영문 소문자 · 숫자 8자리)', /^[a-z0-9]{8}$/.test(code || ''), true);
  check('A: 코드 표시', a.d.getElementById('sync-code').textContent, code);
  let [st, srv] = await apiGet(code);
  check('서버에 A 시간표 저장됨', [st, srv && srv.classes.length], [200, 6]);
  a.save();

  // 11/21 전날 밤 알림 카드 없앰: 서버에 저장된 알림 설정은 설정 화면에서 저장해도 지워지지 않아야 함
  const nOn = { enabled: true, channel: 'ntfy', topic: 'wakeup-keep12345', sendAt: '22:30' };
  await fetch(API + 'profile/' + code, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...srv, notify: nOn }) });
  a = await open(A, 'setup.html');
  check('알림 카드 없음', a.d.getElementById('notify-enabled'), null);
  a.submit(); await tick(250);
  [st, srv] = await apiGet(code);
  const sorted = o => Object.fromEntries(Object.entries(o).sort());   // 서버 JSON 은 키 순서가 다름
  check('설정 화면에서 저장해도 서버의 알림 설정 그대로', sorted(srv.notify), sorted(nOn));
  a.save();

  // 기기 B: 코드로 불러오기
  let b = await open(B, 'setup.html');
  b.d.getElementById('sync-input').value = 'BAD';
  b.d.getElementById('sync-load').click(); await tick();
  check('B: 형식 틀린 코드 안내', b.d.querySelector('[data-err="sync"]').textContent, '코드는 영문 소문자 · 숫자 8자리예요');
  b.d.getElementById('sync-input').value = 'zzzz2222';
  b.d.getElementById('sync-load').click(); await tick(200);
  check('B: 없는 코드 안내', b.d.querySelector('[data-err="sync"]').textContent, '이 코드로 저장된 시간표가 없어요');
  b.d.getElementById('sync-input').value = ' ' + code.toUpperCase() + ' ';
  b.d.getElementById('sync-load').click(); await tick(200);
  check('B: 대문자 · 공백 섞여도 코드로 불러오기 성공', [b.status(), b.d.querySelectorAll('.class-item').length, b.w.localStorage.getItem('wakeup.sync')], ['서버에서 시간표를 불러와 이 기기에도 저장했어요.', 6, code]);
  // B 에서 첫 수업 이름 수정 → 저장 (11/21 설정 화면 통학 칸 없앰 → 수업으로 동기화 확인)
  const firstName = () => b.d.querySelector('.class-item [data-field="name"]');
  firstName().value = '동기화B';
  b.submit(); await tick(250);
  check('B: 저장 → 서버에도 저장 메시지', b.status().includes('서버에도 저장돼서'), true);
  [st, srv] = await apiGet(code);
  check('서버 저장본 첫 수업 이름 동기화B', srv.classes[0].name, '동기화B');
  b.save();

  // 기기 A: 대시보드를 열면 서버 최신본
  a = await open(A, 'index.html');
  check('A 대시보드: 서버 최신본 반영 (수업 이름 동기화B)', a.d.body.textContent.includes('동기화B'), true);
  a.save();
  check('A: 이 기기 저장본도 서버 최신본으로 갱신', JSON.parse(A.store['wakeup.v1']).classes[0].name, '동기화B');

  // 기기 A: 등록 화면을 열면 서버 값으로 채워짐
  a = await open(A, 'setup.html');
  check('A 등록: 서버 값으로 채워짐', a.d.querySelector('.class-item [data-field="name"]').value, '동기화B');
  a.save();

  // 서버 장애 → 이 기기 저장본 + 경고
  apiDown = true;
  a = await open(A, 'index.html');
  check('서버 장애: 대시보드는 이 기기 저장본 + 경고', [a.d.getElementById('next-card').classList.contains('hidden'), a.d.getElementById('status').textContent.includes('서버에 연결하지 못했어요')], [false, true]);
  a.save();
  a = await open(A, 'setup.html');
  a.d.querySelector('.class-item [data-field="name"]').value = '장애중A';
  a.submit(); await tick(200);
  check('서버 장애 중 저장: 이 기기엔 저장 + 서버 실패 안내', [a.status().startsWith('이 기기에는 저장했지만 서버 저장은 실패'), JSON.parse(a.w.localStorage.getItem('wakeup.v1')).classes[0].name], [true, '장애중A']);
  check('서버 장애 중 저장: 못 보냄 표시', a.w.localStorage.getItem('wakeup.pending'), '1');
  a.save();
  a = await open(A, 'index.html');
  check('서버 계속 장애: 이 기기 수정본(장애중A) + 미전송 경고', [a.d.body.textContent.includes('장애중A'), a.d.getElementById('status').textContent.includes('아직 서버에 저장되지 않았어요')], [true, true]);
  a.save();
  apiDown = false;
  a = await open(A, 'index.html');
  check('서버 복구: 이 기기 수정본 유지 (장애중A, 예전 동기화B로 안 덮임)', [a.d.body.textContent.includes('장애중A'), a.d.body.textContent.includes('동기화B')], [true, false]);
  a.save();
  [st, srv] = await apiGet(code);
  check('서버 복구: 수정본이 서버로 올라감 · 표시 지워짐', [srv.classes[0].name, A.store['wakeup.pending'] || null], ['장애중A', null]);

  // 연결 해제
  b = await open(B, 'setup.html');
  b.d.getElementById('sync-off').click(); await tick();
  check('B: 연결 해제 → 코드 삭제, 시간표는 남음', [b.w.localStorage.getItem('wakeup.sync'), !!b.w.localStorage.getItem('wakeup.v1'), b.d.getElementById('sync-off-box').classList.contains('hidden')], [null, true, false]);
  b.save();
  // 모두 지우기 → 코드까지 삭제
  a = await open(A, 'setup.html');
  a.d.getElementById('clear-all').click(); await tick();
  check('A: 모두 지우기 → 시간표 · 코드 삭제', [a.w.localStorage.getItem('wakeup.v1'), a.w.localStorage.getItem('wakeup.sync')], [null, null]);
  a.save();
  a = await open(A, 'index.html');
  check('A: 지운 뒤 대시보드는 첫 방문 화면 (서버에서 되살아나지 않음)', a.d.getElementById('intro').classList.contains('hidden'), false);
  a.w.close();

  check('스크립트 오류 없음', errs, []);
  console.log(`==> ${pass} / ${pass + fail} PASS ${fail ? '❌' : '✅'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
