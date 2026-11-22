// 첫 페이지 (start.html) · 처음 온 사람만 보내기 (js/gate.js) — node start.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const { JSDOM } = require('jsdom');
const site = path.join(__dirname, '..', 'site');
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `\n     기대 ${JSON.stringify(expected)}\n     실제 ${JSON.stringify(actual)}`));
}

/* ---------- gate.js: 가짜 window 에서 실행해 어디로 보내는지 본다 ---------- */
const gate = fs.readFileSync(path.join(site, 'js', 'gate.js'), 'utf8');
function runGate(store, search = '', opts = {}) {
  let went = null;
  const data = { ...store };
  const localStorage = opts.blocked ? { getItem() { throw new Error('blocked'); } } : {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { if (opts.readOnly) throw new Error('quota'); data[k] = String(v); },
    removeItem: k => { delete data[k]; }
  };
  vm.runInNewContext(gate, { window: { localStorage, location: { search, replace: u => { went = u; } } } });
  return { went, keys: Object.keys(data).sort() };
}
check('처음 온 사람 → start.html', runGate({}).went, 'start.html');
check('확인용 키는 남기지 않음', runGate({}).keys, []);
check('저장된 시간표 있음 → 그대로 대시보드', runGate({ 'wakeup.v1': '{}' }).went, null);
check('동기화 코드 있음 → 그대로', runGate({ 'wakeup.sync': 'abcd1234' }).went, null);
check('[시작하기] 누른 적 있음 → 그대로', runGate({ 'wakeup.started': '1' }).went, null);
check('예시 · 알림 재현 주소(?demo=9) → 그대로', runGate({}, '?demo=9').went, null);
check('다른 쿼리는 무시하고 보냄', runGate({}, '?x=1').went, 'start.html');
check('저장소 읽기 막힘 → 보내지 않음 (무한 반복 방지)', runGate({}, '', { blocked: true }).went, null);
check('저장소 쓰기 막힘 → 보내지 않음', runGate({}, '', { readOnly: true }).went, null);

/* ---------- start.html ---------- */
const html = fs.readFileSync(path.join(site, 'start.html'), 'utf8');
const dom = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ''), { url: 'http://localhost/wakeup/start.html', runScripts: 'outside-only' });
const w = dom.window, d = w.document;
const errors = [];
w.addEventListener('error', e => errors.push(e.message));
for (const s of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])) w.eval(fs.readFileSync(path.join(site, s.split('?')[0]), 'utf8'));
check('제목 두 줄 · 알림과 기상이 같은 무게 (강조 단어 2개)', [d.querySelectorAll('h1 .wh-line').length, [...d.querySelectorAll('h1 em')].map(e => e.textContent)], [2, ['알림', '기상 시각']]);
check('제목 · 소개 문구', [d.querySelector('h1').textContent, !!d.querySelector('.welcome-sub').textContent.trim()], ['수업 전엔 알림,아침엔 기상 시각', true]);
check('특징 3줄 (알림 → 기상 → 등록)', [...d.querySelectorAll('.welcome-points strong')].map(e => e.textContent), ['수업 10분 전 알림', '요일별 기상 · 출발 시각', '에타 링크로 한 번 등록']);
const start = d.getElementById('start');
check('[시작하기] 하나 · 대시보드로 (상대 경로)', [d.querySelectorAll('a.btn, button').length, start.textContent.trim(), start.getAttribute('href')], [1, '시작하기', 'index.html']);
start.addEventListener('click', e => e.preventDefault());   // jsdom 이 이동하지 않게
start.click();
check('[시작하기] → 시작 기록 남김', w.localStorage.getItem('wakeup.started'), '1');
check('외부 주소 · CDN 없음', (html.match(/https?:\/\//g) || []).length, 0);
check('스크립트는 js/ 안의 파일만', [...html.matchAll(/<script[^>]*>/g)].every(m => /src="js\/[\w-]+\.js\?v=/.test(m[0])), true);
check('하단 탭 없음 (nav.js 안 불러옴)', html.includes('nav.js'), false);
check('index.html 이 gate.js 를 <head> 에서 가장 먼저 불러옴', /<title>[^<]*<\/title>\s*<script src="js\/gate\.js\?v=/.test(fs.readFileSync(path.join(site, 'index.html'), 'utf8')), true);
check('스크립트 오류 없음', errors, []);

console.log(`==> ${pass} / ${pass + fail} PASS ${fail ? '❌' : '✅'}`);
process.exit(fail ? 1 : 0);
