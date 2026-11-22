// 대시보드(index.html) 동작 검사 — jsdom, 시계 고정 (plan.md A-6)
// 실행: cd tests && npm install && TZ=Asia/Seoul node dashboard.test.js
// 2026-11-23 = 월요일. 픽스처 수업: 월 10:30 자료구조 · 화 18:50 캡스톤디자인 · 수 09:00 자료구조 · 토 09:00 토요특강
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const SITE = path.join(__dirname, '..', 'site');
const IMPORT_OK = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'import-result.json'), 'utf8'));
const wait = (ms = 40) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const errors = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `\n     기대 ${JSON.stringify(expected)}\n     실제 ${JSON.stringify(actual)}`));
}

// 가짜 에타 가져오기 API (서버 test_import.py 가 실제 파서 · API 를 따로 검사)
const API = {
  'https://everytime.kr/@okLink': [200, IMPORT_OK],
  'https://everytime.kr/@privateLink': [403, { error: '공개되지 않은 시간표예요. 에타 시간표 설정에서 공개 범위를 \'전체 공개\'로 바꾼 뒤 다시 시도해 주세요.', reason: 'private' }],
  'https://everytime.kr/@emptyLink': [422, { error: '가져올 수업이 없어요. 이번 학기 시간표에 수업이 있는지 확인해 주세요.', reason: 'empty' }],
  'https://everytime.kr/@slowLink': [200, IMPORT_OK, 120],
  'https://naver.com': [400, { error: '에타 시간표 공유 링크(https://everytime.kr/@…)를 붙여 주세요.', reason: 'invalid_url' }],
};

const SERVER = {};
/** 기기 하나 = localStorage · sessionStorage 묶음 */
function device() { return { local: {}, session: {} }; }

async function open(dev, iso, opts = {}) {
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const dom = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ''), {
    url: 'http://localhost/wakeup/index.html' + (opts.search || ''), runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  let fake = new Date(iso).getTime();
  const RealDate = w.Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(fake); else super(...a); }
    static now() { return fake; }
  }
  w.Date = FakeDate;
  for (const [k, v] of Object.entries(dev.local)) w.localStorage.setItem(k, v);
  for (const [k, v] of Object.entries(dev.session)) w.sessionStorage.setItem(k, v);
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.scrollTo = () => {};
  const calls = [];
  w.fetch = async (url, o = {}) => {
    if (url === 'api/import/everytime') {
      const body = JSON.parse(o.body);
      calls.push(body.url);
      if (opts.network === false) throw new TypeError('network');
      const [status, data, delay] = API[body.url] || [404, { error: '존재하지 않는 시간표예요. 링크를 다시 복사해 주세요.', reason: 'not_found' }];
      if (delay) await new Promise(r => setTimeout(r, delay));
      return { ok: status === 200, status, json: async () => data };
    }
    if (url.startsWith('api/profile/') && opts.profileApi) {   // 가짜 저장 API (기기끼리 공유되는 SERVER)
      if (opts.profileApi === 'down') throw new TypeError('network');
      const code = url.slice('api/profile/'.length);
      if ((o.method || 'GET') === 'PUT') { SERVER[code] = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
      return SERVER[code] ? { ok: true, status: 200, json: async () => SERVER[code] } : { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    }
    if (url.startsWith('api/')) throw new TypeError('no server in test');
    const p = path.join(SITE, url);
    if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
  };
  w.addEventListener('error', e => errors.push(e.message));
  for (const s of srcs) w.eval(fs.readFileSync(path.join(SITE, s.split('?')[0]), 'utf8'));
  await wait(60);
  const d = w.document;
  const $ = id => d.getElementById(id);
  return {
    w, d, $, calls,
    hidden: id => $(id).classList.contains('hidden'),
    text: id => $(id).textContent.replace(/\s+/g, ' ').trim(),
    async at(iso2) { fake = new Date(iso2).getTime(); w.WakeDashboard.tick(); await wait(10); },
    async importUrl(u) { $('import-url').value = u; $('import-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await wait(40); },
    close() {
      dev.local = {}; dev.session = {};
      for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); dev.local[k] = w.localStorage.getItem(k); }
      for (let i = 0; i < w.sessionStorage.length; i++) { const k = w.sessionStorage.key(i); dev.session[k] = w.sessionStorage.getItem(k); }
      w.close();
    }
  };
}

(async () => {
  /* ===== 1. 첫 방문 ===== */
  const A = device();
  let p = await open(A, '2026-11-23T08:55:00');
  check('첫 방문: 상단 버튼 "에타 시간표 등록"', p.text('btn-register'), '에타 시간표 등록');
  check('첫 방문: 안내 · 예시 주간 시간표 보임, 다음 수업 · 오늘 카드는 숨김', [p.hidden('intro'), p.hidden('week-card'), p.hidden('next-card'), p.hidden('today-card')], [false, false, true, true]);
  check('첫 방문: 예시 배지 · 예시 수업 칸은 줄무늬(is-example)', [p.hidden('week-badge'), p.d.querySelectorAll('.tt-block').length > 0, [...p.d.querySelectorAll('.tt-block')].every(b => b.classList.contains('is-example'))], [false, true, true]);
  check('첫 방문: 예시 수업(월 09:00)이 5분 뒤여도 알림 없음', p.hidden('alert-banner'), true);
  check('첫 방문: 하단 탭 2개 (대시보드 · 설정)', [...p.d.querySelectorAll('.tabbar a')].map(a => a.textContent), ['대시보드', '설정']);
  check('첫 방문: 등록 버튼이 가장 눈에 띄는 행동 (btn-primary) · body data-mode=first', [p.$('btn-register').classList.contains('btn-primary'), p.d.body.dataset.mode], [true, 'first']);

  /* ===== 2. 등록 → 가져오기 실패 ===== */
  p.$('btn-register').click(); await wait();
  check('등록: URL 입력칸 표시 · 포커스', [p.hidden('register'), p.d.activeElement && p.d.activeElement.id], [false, 'import-url']);
  check('등록: 단계 표시 1(링크 입력)', p.d.querySelector('#import-steps li.is-active').getAttribute('data-step'), '1');
  await p.importUrl('');
  check('실패: 빈칸 → 안내 (서버 요청 안 함)', [p.text('import-error-msg').startsWith('에타 시간표 공유 링크'), p.calls.length], [true, 0]);
  await p.importUrl('https://naver.com');
  check('실패: 잘못된 주소 → 이유 안내 + [예시 시간표로 체험]', [p.hidden('import-error'), p.text('import-error-msg').includes('everytime.kr/@'), p.text('import-error').includes('예시 시간표로 체험')], [false, true, true]);
  await p.importUrl('https://everytime.kr/@privateLink');
  check('실패: 비공개 → "공개되지 않은 시간표" 안내', p.text('import-error-msg').includes('공개되지 않은 시간표'), true);
  await p.importUrl('https://everytime.kr/@missing');
  check('실패: 없는 시간표 → 안내', p.text('import-error-msg').includes('존재하지 않는 시간표'), true);
  await p.importUrl('https://everytime.kr/@emptyLink');
  check('실패: 수업 없음 → 안내', p.text('import-error-msg').includes('가져올 수업이 없어요'), true);
  check('실패해도 저장된 것 없음', p.w.localStorage.getItem('wakeup.v1'), null);
  p.close();
  p = await open(A, '2026-11-23T08:55:00', { network: false });
  p.$('btn-register').click(); await p.importUrl('https://everytime.kr/@okLink');
  check('실패: 서버 연결 안 됨 → 안내', p.text('import-error-msg').includes('서버에 연결하지 못했어요'), true);
  p.d.querySelector('#import-error [data-action="demo"]').click(); await wait();
  check('실패 화면에서 [예시 시간표로 체험] → 체험 모드', [p.hidden('demo-bar'), p.hidden('next-card'), p.hidden('register')], [false, false, true]);
  p.$('demo-end').click(); await wait();
  check('체험 끝내기 → 첫 화면으로', [p.hidden('intro'), p.hidden('demo-bar')], [false, true]);
  p.close();

  /* ===== 3. 가져오기 성공 → 확인 → 저장 ===== */
  p = await open(A, '2026-11-23T10:00:00');
  p.$('btn-register').click();
  p.$('import-url').value = 'https://everytime.kr/@slowLink';
  p.$('import-form').dispatchEvent(new p.w.Event('submit', { cancelable: true })); await wait(20);
  check('가져오는 중: 진행 안내 표시 · 버튼 잠금 · 오류 · 미리보기 숨김', [p.hidden('import-loading'), p.$('import-go').disabled, p.text('import-go'), p.hidden('import-error'), p.hidden('import-preview')], [false, true, '가져오는 중…', true, true]);
  await wait(160);
  check('가져오기 끝: 진행 안내 숨김 · 미리보기 · 단계 2(수업 확인)', [p.hidden('import-loading'), p.text('import-go'), p.hidden('import-preview'), p.d.querySelector('#import-steps li.is-active').getAttribute('data-step')], [true, '가져오기', false, '2']);
  p.$('import-retry').click(); await wait();
  await p.importUrl('https://everytime.kr/@okLink');
  check('성공: 미리보기 (과목 · 요일 · 시각 · 강의실)', [...p.d.querySelectorAll('#preview-list li')].map(li => li.textContent), [
    '월10:30–11:45자료구조E21-101', '화18:50–21:15캡스톤디자인E21-102', '수09:00–10:15자료구조E21-101', '토09:00–12:00토요특강E21-103']);
  check('성공: 요약 · 제외 과목 안내', [p.text('preview-summary'), p.text('preview-notes')], ['2026년 2학기 · 수업 4개를 가져왔어요. 확인 후 저장해 주세요.', '시간이 없는 과목 1개는 제외했어요: 온라인교양']);
  check('미리보기 단계에서는 아직 저장 안 됨', p.w.localStorage.getItem('wakeup.v1'), null);
  p.$('import-retry').click(); await wait();
  check('[다시 입력] → 입력칸으로', [p.hidden('import-form'), p.hidden('import-preview')], [false, true]);
  await p.importUrl('https://everytime.kr/@okLink');
  p.$('import-save').click(); await wait();
  const saved = JSON.parse(p.w.localStorage.getItem('wakeup.v1'));
  check('[시간표 저장] → 저장 (수업 4개, 통학 정보 없음)', [saved.classes.length, saved.commute], [4, null]);
  check('저장 후: 대시보드 · 버튼 "시간표 다시 등록" · 예시 배지 없음', [p.hidden('register'), p.hidden('intro'), p.hidden('next-card'), p.text('btn-register'), p.hidden('week-badge')], [true, true, false, '시간표 다시 등록', true]);
  check('저장 후: 다음 수업 카드 (월 10:00 → 10:30 자료구조 · E21-101 · 00:30:00)', [p.d.querySelector('.next-name').textContent, p.d.querySelector('.next-meta').textContent, p.d.querySelector('#next-body .count').textContent], ['자료구조', '오늘 10:30 시작 · E21-101', '00:30:00']);
  check('저장 후: 오늘 남은 수업 (시각 | 과목 · 강의실)', [p.text('today-body'), p.text('today-count')], ['10:30–11:45자료구조E21-101', '1개']);
  check('저장 후: 오늘 목록에서 다음 수업 강조', p.d.querySelector('.class-left li').className, 'is-next');
  check('저장 후: 주간 시간표에서 다음 수업 칸(월 10:30) 강조 · 현재 시각 선 표시', [[...p.d.querySelectorAll('.tt-block.is-next')].map(b => b.querySelector('.tt-name').textContent + b.querySelector('.tt-time').textContent), p.d.querySelector('.tt-col.is-today .tt-now').classList.contains('hidden')], [['자료구조10:30'], false]);
  check('저장 후: 10분 전 알림 예정 시각 안내 (10:20)', p.text('next-body').includes('10:20에 이 화면에서 10분 전 알림'), true);
  check('저장 후: 등록 버튼은 보조 버튼으로 (btn-primary 아님)', p.$('btn-register').classList.contains('btn-primary'), false);
  check('저장 후: 주간 시간표 칸 = 내 수업 4개 (줄무늬 아님)', [p.d.querySelectorAll('.tt-block').length, p.d.querySelectorAll('.tt-block.is-example').length], [4, 0]);
  check('토요일 수업이 있으면 토요일 열 표시', [...p.d.querySelectorAll('.tt-head span')].map(s => s.textContent).join(''), '월화수목금토');
  p.close();

  /* ===== 4. 재접속 ===== */
  p = await open(A, '2026-11-23T11:00:00');
  check('재접속: 바로 내 시간표 대시보드', [p.hidden('intro'), p.hidden('next-card'), p.text('btn-register')], [true, false, '시간표 다시 등록']);
  check('재접속 11:00: 수업 중 표시 · 오늘 남은 수업에 "수업 중" 태그', [p.text('next-body').includes('지금 수업 중 · 자료구조'), p.d.querySelector('.class-left li.is-now .tag').textContent], [true, '수업 중']);
  await p.at('2026-11-23T12:00:00');
  check('오늘 수업 끝 → "오늘 남은 수업 없음"', p.text('today-body'), '오늘 남은 수업 없음');
  check('다음 수업 카드에 날짜 표시 (내일 · 11월 24일 (화) 18:50)', [p.d.querySelector('.next-meta').textContent, p.d.querySelector('#next-body .count').textContent], ['내일 · 11월 24일 (화) 18:50 시작 · E21-102', '1일 06:50:00']);
  check('통학 계획: 통학 정보 없으면 안내 + [통학 시간 계산] · 다음 수업 아래 설정 띠', [p.hidden('commute-card'), p.text('commute-body').includes('출발 · 기상 시각'), p.text('cm-open'), p.text('next-body').includes('통학 시간을 넣으면 출발 · 기상 시각도 알려 드려요')], [false, true, '통학 시간 계산', true]);
  p.close();

  /* ===== 5. 다시 등록 → 교체 (통학 정보는 유지) ===== */
  const withCommute = JSON.parse(A.local['wakeup.v1']);
  withCommute.commute = { prepMin: 40, walkToStopMin: 5, walkToRoomMin: 8, bufferMin: 0, routeId: 'route-a', customTimes: null };
  A.local['wakeup.v1'] = JSON.stringify(withCommute);
  const changed = JSON.parse(JSON.stringify(IMPORT_OK));
  changed.classes = [{ id: 'e1', name: '새과목', day: 4, start: '13:00', end: '14:15', room: 'E21-201' }];
  API['https://everytime.kr/@okLink2'] = [200, changed];
  p = await open(A, '2026-11-23T12:00:00');
  p.$('btn-register').click(); await p.importUrl('https://everytime.kr/@okLink2');
  check('다시 등록: 저장 버튼에 "기존 시간표 교체" 표시', p.text('import-save'), '시간표 저장 (기존 시간표 교체)');
  p.$('import-save').click(); await wait(80);
  const replaced = JSON.parse(p.w.localStorage.getItem('wakeup.v1'));
  check('다시 등록 저장 → 시간표 교체 · 통학 정보 유지', [replaced.classes.map(c => c.name), replaced.commute.routeId], [['새과목'], 'route-a']);
  check('통학 계획: 요일별 기상 · 출발 계산 (목 13:00 → 12:00 버스 → 11:15 기상)', p.text('commute-body').includes('목첫 수업 13:0011:15 기상 · 11:55 출발 · 12:00 버스'), true);
  {
    const b = p.d.querySelector('#commute-body .cm-shortcut a.btn');
    check('아이폰 알람 (버스 시간표 모드): 버튼 있음 · 목 11:15 포함', b && JSON.parse(new URL(b.getAttribute('href')).searchParams.get('text'))['4'], '11:15');
  }
  p.close();
  A.local['wakeup.v1'] = JSON.stringify(saved);   // 원래 4개 수업으로 되돌림

  /* ===== 6. 수업 10분 전 알림 (월 10:30 자료구조) ===== */
  p = await open(A, '2026-11-23T10:19:59');
  check('10분 1초 전 → 알림 없음', p.hidden('alert-banner'), true);
  await p.at('2026-11-23T10:20:00');
  check('정확히 10분 전 → 배너 (과목 · 강의실 · 남은 시간)', [p.hidden('alert-banner'), p.text('alert-name'), p.text('alert-room'), p.text('alert-left')], [false, '자료구조', '· E21-101', '10분 0초']);
  check('탭 제목에 🔔', p.d.title.startsWith('🔔 10분 뒤 자료구조'), true);
  await p.at('2026-11-23T10:25:30');
  check('카운트다운 갱신 (4분 30초)', p.text('alert-left'), '4분 30초');
  await p.at('2026-11-23T10:30:00');
  check('시작 시각 → 배너 사라짐', [p.hidden('alert-banner'), p.d.title], [true, '영남대 통학 기상 알리미']);
  p.close();

  A.local['wakeup.alerted'] = undefined; delete A.local['wakeup.alerted'];
  p = await open(A, '2026-11-23T10:23:00');
  check('7분 전에 페이지를 열어도 실제 남은 시간 (7분 0초)', [p.hidden('alert-banner'), p.text('alert-left')], [false, '7분 0초']);
  p.$('alert-close').click(); await p.at('2026-11-23T10:23:05');
  check('[확인]으로 닫으면 다시 안 뜸', p.hidden('alert-banner'), true);
  p.close();
  p = await open(A, '2026-11-23T10:24:00');
  check('중복: 같은 날 다시 열어도 같은 수업 알림 안 뜸', p.hidden('alert-banner'), true);
  check('알림 기록 (당일 · 키)', JSON.parse(p.w.localStorage.getItem('wakeup.alerted')), { date: '2026-11-23', keys: ['e1|10:30'] });
  p.close();
  p = await open(A, '2026-11-23T10:30:00');
  check('이미 시작한 수업 → 알림 없음', p.hidden('alert-banner'), true);
  p.close();
  p = await open(A, '2026-11-30T10:21:00');
  check('다음 주 같은 수업 → 날짜가 바뀌어 다시 알림 (9분 0초)', [p.hidden('alert-banner'), p.text('alert-left')], [false, '9분 0초']);
  p.close();

  /* ===== 7. 예시 체험 · 알림 재현 (발표용, plan.md A-4) ===== */
  const B = device();
  p = await open(B, '2026-11-25T14:31:20');
  p.d.querySelector('#intro [data-action="demo"]').click(); await wait();
  check('체험: 예시 데이터로 대시보드 (예시 배지 · 체험 안내)', [p.hidden('demo-bar'), p.hidden('next-card'), p.hidden('week-badge')], [false, false, false]);
  p.$('demo-alert').click(); await wait();
  check('[알림 바로 확인] → 9분 뒤 체험 수업 + 즉시 배너', [p.hidden('alert-banner'), p.text('alert-name'), p.text('alert-left')], [false, '알림 체험 수업', '8분 40초']);
  check('체험 수업은 주간 시간표에 따로 표시 (is-demo)', p.d.querySelectorAll('.tt-block.is-demo').length, 1);
  check('체험 데이터는 저장 안 됨 (localStorage 에 시간표 없음)', p.w.localStorage.getItem('wakeup.v1'), null);
  p.close();
  p = await open(B, '2026-11-25T14:32:00');
  check('체험: 새로고침 → 체험 유지 · 같은 알림 다시 안 뜸', [p.hidden('demo-bar'), p.hidden('alert-banner')], [false, true]);
  p.$('demo-alert').click(); await wait();
  check('체험: [알림 바로 확인] 다시 → 새 체험 수업이라 다시 뜸', p.hidden('alert-banner'), false);
  p.close();
  const Cdev = device();
  p = await open(Cdev, '2026-11-25T14:31:00', { search: '?demo=9' });
  check('주소 ?demo=9 → 체험 + 즉시 배너 (9분 0초) · 주소 정리', [p.hidden('demo-bar'), p.hidden('alert-banner'), p.text('alert-left'), p.w.location.search], [false, false, '9분 0초', '']);
  p.close();

  /* ===== 8. 브라우저에 예전 storage.js 가 남아 있을 때 (11/21 실제 사례) ===== */
  p = await open(device(), '2026-11-23T10:00:00');
  delete p.w.WakeStorage.importEverytime;
  p.$('btn-register').click(); await p.importUrl('https://everytime.kr/@okLink');
  check('예전 storage.js 가 섞이면 멈추지 않고 새로고침 안내', [p.hidden('import-error'), p.text('import-error-msg').includes('새로고침'), p.calls.length], [false, true, 0]);
  p.close();

  /* ===== 9. 크롬 확장 연결 (동기화 코드 만들기 · 보여 주기) ===== */
  const E = device();
  p = await open(E, '2026-11-23T10:00:00', { profileApi: true });
  check('확장 연결: 첫 방문(시간표 없음)에는 숨김', p.hidden('ext-card'), true);
  p.$('btn-register').click(); await p.importUrl('https://everytime.kr/@okLink');
  p.$('import-save').click(); await wait();
  check('확장 연결: 저장 후 표시 · 접힘 · 코드 없으면 [동기화 코드 만들기]', [p.hidden('ext-card'), p.$('ext-card').open, p.hidden('ext-nocode'), p.hidden('ext-hascode')], [false, false, false, true]);
  p.$('ext-make').click(); await wait(80);
  const extCode = p.w.localStorage.getItem('wakeup.sync');
  check('확장 연결: 코드 생성(8자리) · 화면에 표시 · 서버에 시간표 저장', [/^[a-z0-9]{8}$/.test(extCode || ''), p.text('ext-code'), p.hidden('ext-hascode'), SERVER[extCode] && SERVER[extCode].classes.length], [true, extCode, false, 4]);
  check('확장 연결: 완료 안내', p.text('ext-msg').startsWith('코드를 만들고 시간표를 서버에 저장했어요'), true);
  p.close();
  p = await open(E, '2026-11-23T10:05:00', { profileApi: true });
  check('확장 연결: 재접속해도 같은 코드 표시', [p.hidden('ext-card'), p.text('ext-code')], [false, extCode]);
  p.close();
  const F = device();
  F.local['wakeup.v1'] = JSON.stringify(saved);
  p = await open(F, '2026-11-23T10:00:00', { profileApi: 'down' });
  p.$('ext-make').click(); await wait(80);
  check('확장 연결: 서버가 안 되면 안내 · 코드 저장 안 함', [p.text('ext-msg').startsWith('코드를 만들지 못했어요'), p.w.localStorage.getItem('wakeup.sync'), p.text('ext-make')], [true, null, '동기화 코드 만들기']);
  p.close();

  /* ===== 10. 통학 시간 계산 (출발지 · 도착지 · 준비 · 여유 → 이동 시간 → 총 소요 · 요일별 기상) ===== */
  const G = device();
  G.local['wakeup.v1'] = JSON.stringify(saved);              // 월 10:30 · 화 18:50 · 수 09:00 · 토 09:00, 통학 정보 없음
  p = await open(G, '2026-11-23T08:00:00');
  const setIn = (id, v) => { p.$(id).value = v; p.$(id).dispatchEvent(new p.w.Event('input')); };
  p.d.querySelector('#next-body [data-action="commute"]').click(); await wait();
  check('통학: 띠의 [설정] → 계산 패널 · 단계 1 · 출발지 포커스 · 도착지 기본값 영남대', [p.hidden('commute-form'), p.d.querySelector('#cm-steps li.is-active').getAttribute('data-step'), p.d.activeElement.id, p.$('cm-to').value, p.text('cm-open')], [false, '1', 'cm-from', '영남대', '닫기']);
  check('통학: 지하철 역 자동 완성 목록 (2호선 29개 역)', p.d.querySelectorAll('#cm-stations option').length, 29);
  p.$('cm-calc').click(); await wait();
  check('통학: 출발지 빈칸 → 안내 (계산 안 함)', [p.text('cm-form-err').startsWith('출발지를 입력해 주세요'), p.hidden('cm-result')], [true, true]);
  p.$('cm-from').value = '반월당역'; setIn('cm-prep', '40'); setIn('cm-buffer', '10');
  p.$('cm-calc').click(); await wait(60);
  check('통학: 길찾기 API 연결 전 → 2호선 시각표로 대체 (반월당 → 영남대 27분) · 단계 2', [p.text('cm-route').startsWith('대구 2호선 시각표로 계산했어요'), p.$('cm-travel').value, p.d.querySelector('#cm-steps li.is-active').getAttribute('data-step')], [true, '27', '2']);
  check('통학: 미리보기 총 소요 1시간 17분 · 월 10:30 → 09:53 출발 → 09:13 기상', [p.d.querySelector('#cm-total .cm-total-num').textContent, [...p.d.querySelectorAll('#cm-total tbody tr')].map(r => r.textContent)[0]], ['1시간 17분', '월10:3009:5309:13']);
  p.$('cm-from').value = '경산시청'; p.$('cm-calc').click(); await wait(60);
  check('통학: 2호선 밖 출발지 → 직접 입력 안내 (이전 값 유지)', [p.text('cm-route').startsWith('이 구간은 아직 자동 계산이 안 돼요'), p.$('cm-travel').value], [true, '27']);
  setIn('cm-travel', '0');
  check('통학: 이동 0분 → 저장 막음 · 칸 표시', [p.$('cm-save').disabled, p.$('cm-travel').getAttribute('aria-invalid'), p.text('cm-err')], [true, 'true', '이동 시간은 1 이상의 정수(분)로 입력해 주세요']);
  setIn('cm-travel', '27');
  p.$('cm-save').click(); await wait();
  const gSaved = JSON.parse(p.w.localStorage.getItem('wakeup.v1'));
  check('통학: 저장 → 분 세 개만 저장 (출발지 · 도착지 저장 안 함) · 패널 닫힘 · 안내', [gSaved.commute, gSaved.classes.length, p.hidden('commute-form'), p.text('status').startsWith('통학 시간을 저장했어요 (총 1시간 17분)'), JSON.stringify(gSaved).includes('반월당')], [{ prepMin: 40, travelMin: 27, bufferMin: 10 }, 4, true, true, false]);
  {
    const sc = p.d.querySelector('#commute-body .cm-shortcut a.btn');
    const u = sc ? new URL(sc.getAttribute('href')) : null;
    check('아이폰 알람: 단축어 "통학알람" 실행 버튼 · 요일별 기상 (월 09:13 · 화 17:33 · 수 07:43 · 토 07:43)',
      u && [u.protocol, decodeURIComponent(u.searchParams.get('name')), u.searchParams.get('input'), JSON.parse(u.searchParams.get('text'))],
      ['shortcuts:', '통학알람', 'text', { 1: '09:13', 2: '17:33', 3: '07:43', 6: '07:43' }]);
    // 화면의 QR(SVG)을 실제로 디코드 → ① iCloud 설치 링크 · ② 버튼과 같은 실행 주소
    const decoded = [...p.d.querySelectorAll('#commute-body .sc-qr svg')].map(svg => {
      const size = Number(svg.getAttribute('viewBox').split(' ')[2]), s = 4, W = size * s;
      const px = new Uint8ClampedArray(W * W * 4).fill(255);
      for (const m of svg.querySelector('path').getAttribute('d').matchAll(/M(\d+) (\d+)/g)) {
        const x0 = Number(m[1]) * s, y0 = Number(m[2]) * s;
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const i = ((y0 + y) * W + x0 + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
      }
      const r = require('jsqr')(px, W, W);
      return r && r.data;
    });
    check('아이폰 알람: PC용 QR 2개 디코드 = 설치 링크 · 실행 주소', [decoded.length, decoded[0] && decoded[0].startsWith('https://www.icloud.com/shortcuts/'), decoded[1] === (sc && sc.getAttribute('href'))], [2, true, true]);
  }
  check('통학 계획: 총 소요 · 요일별 표 (월 · 화 · 수 · 토) · [다시 계산]', [p.d.querySelector('#commute-body .cm-total-num').textContent, [...p.d.querySelectorAll('#commute-body tbody th')].map(t => t.textContent), p.text('cm-open')], ['1시간 17분', ['월', '화', '수', '토'], '다시 계산']);
  check('통학 띠: 월 08:00 → 출발까지 1:53:00 · 09:53 출발 · 09:13 기상 기준', [p.d.querySelector('.cstrip .cs-title').textContent, p.d.querySelector('.cstrip .cs-sub').textContent], ['출발까지 1:53:00', '09:53 출발 · 09:13 기상 기준 · 총 1시간 17분']);
  await p.at('2026-11-23T09:50:30');
  check('통학 띠: 출발 2분 30초 전 → 02:30', p.d.querySelector('.cstrip .cs-count').textContent, '02:30');
  await p.at('2026-11-23T10:00:00');
  check('통학 띠: 출발 시각 지남 → 지금 나가면 10:27 도착', [p.d.querySelector('.cstrip').className, p.d.querySelector('.cstrip .cs-title').textContent, p.d.querySelector('.cstrip .cs-sub').textContent], ['cstrip is-missed', '출발 시각 09:53이 지났어요', '지금 나가면 10:27 도착 · 여유 시간이 줄었어요']);
  await p.at('2026-11-23T10:05:00');
  check('통학 띠: 10:05 → 10:32 도착 · 약 2분 지각', p.d.querySelector('.cstrip .cs-sub').textContent, '지금 나가면 10:32 도착 · 약 2분 지각');
  await p.at('2026-11-23T10:30:00');
  check('통학 띠: 첫 수업 시작 후 → 내일(화) 17:33 기상 · 18:13 출발', [p.d.querySelector('.cstrip .cs-title').textContent, p.d.querySelector('.cstrip .cs-sub').textContent], ['내일(화) 17:33 기상', '18:13 출발 · 첫 수업 18:50 · 총 1시간 17분']);
  p.$('cm-copy').click(); await wait();
  check('통학: [단축어용 복사] → 결과 안내 (복사 안 되는 환경은 표 보라고 안내)', [p.hidden('cm-msg'), /복사했어요|자동 복사가 안 돼요/.test(p.text('cm-msg'))], [false, true]);
  p.$('cm-open').click(); await wait();
  check('통학: [다시 계산] → 저장된 준비 · 이동 · 여유 채움', [p.$('cm-prep').value, p.$('cm-travel').value, p.$('cm-buffer').value], ['40', '27', '10']);
  p.$('cm-cancel').click(); await wait();
  check('통학: [취소] → 패널 닫힘 · 저장값 그대로', [p.hidden('commute-form'), JSON.parse(p.w.localStorage.getItem('wakeup.v1')).commute.travelMin], [true, 27]);
  p.close();
  p = await open(G, '2026-11-23T08:00:00');
  p.$('cm-open').click(); await wait();
  check('통학: 새로 열면 출발지는 빈칸 (저장하지 않으므로) · 이동 시간은 저장값', [p.$('cm-from').value, p.$('cm-travel').value], ['', '27']);
  p.close();
  // 11/21 준비 · 여유를 비워 두면 회색 글씨 값(30분 · 10분)으로 계산 · 저장
  const H = device();
  H.local['wakeup.v1'] = JSON.stringify(saved);
  p = await open(H, '2026-11-23T08:00:00');
  p.$('cm-open').click(); await wait();
  check('통학: 준비 · 여유 빈칸 · 회색 글씨 30 · 10', [p.$('cm-prep').value, p.$('cm-buffer').value, p.$('cm-prep').placeholder, p.$('cm-buffer').placeholder], ['', '', '30', '10']);
  p.$('cm-from').value = '반월당역';
  p.$('cm-calc').click(); await wait(60);
  check('통학: 빈칸이어도 저장 가능 · 총 1시간 7분 (30 + 27 + 10)', [p.$('cm-save').disabled, p.text('cm-err'), p.d.querySelector('#cm-total .cm-total-num').textContent], [false, '', '1시간 7분']);
  p.$('cm-save').click(); await wait();
  check('통학: 빈칸 저장 → 준비 30 · 여유 10 으로 저장', JSON.parse(p.w.localStorage.getItem('wakeup.v1')).commute, { prepMin: 30, travelMin: 27, bufferMin: 10 });
  p.close();
  p = await open(device(), '2026-11-23T08:00:00');
  p.d.querySelector('#intro [data-action="demo"]').click(); await wait();
  check('통학 (체험): 예시 반월당역 → 영남대 27분 · 계산 버튼 숨김 · 띠 표시', [p.hidden('commute-card'), p.hidden('cm-open'), p.text('commute-body').includes('반월당역 → 영남대 (대구 2호선 시각표 기준 27분)'), p.d.querySelector('.cstrip .cs-title').textContent], [false, true, true, '출발까지 23:00']);
  check('아이폰 알람 (체험): 평가 · 시연용으로 버튼 · QR 표시 + "예시 시간표 기준" 경고', [!!p.d.querySelector('#commute-body .cm-shortcut a.btn'), p.d.querySelectorAll('#commute-body .sc-qr svg').length, p.text('commute-body').includes('예시 시간표 기준 알람이에요')], [true, 2, true]);
  check('크롬 확장 (체험): 카드 표시 · 확장 받기 · "예시 데이터로 보기" 안내 · 코드 만들기 숨김', [p.hidden('ext-card'), !!p.d.querySelector('#ext-install a[href="download/wakeup-extension.zip"]'), p.hidden('ext-demo'), p.text('ext-demo').includes('예시 데이터로 보기'), p.hidden('ext-nocode'), p.hidden('ext-hascode')], [false, true, false, true, true, true]);
  p.close();

  check('스크립트 오류 없음', errors, []);
  console.log(`==> ${pass} / ${pass + fail} PASS ${fail ? '❌' : '✅'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
