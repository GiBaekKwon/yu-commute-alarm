const fs = require('fs'), path = require('path'), vm = require('vm');
const site = process.argv[2] || require('path').join(__dirname, '..', 'site');
const mem = {};
const ctx = {
  console, Promise, JSON, Date,
  localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } },
  fetch: async (url) => {
    const p = path.join(site, url);
    if (!p.startsWith(site) || !fs.existsSync(p)) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
  }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time', 'calc', 'storage', 'bus']) vm.runInContext(fs.readFileSync(path.join(site, 'js', f + '.js'), 'utf8'), ctx);
const { WakeStorage: S, WakeBus: B, WakeCalc: C, WakeTime: T } = ctx;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `\n     기대 ${JSON.stringify(expected)}\n     실제 ${JSON.stringify(actual)}`));
}

(async () => {
  // storage
  check('저장 전에는 load() = null', S.load(), null);
  const sample = await S.loadSample();
  check('예시 불러오기: 수업 6개, 노선 route-a', [sample.classes.length, sample.commute.routeId], [6, 'route-a']);
  check('예시는 검사 통과', S.validate(sample), []);
  const r1 = S.save(sample);
  check('예시 저장 ok', r1.ok, true);
  check('저장 후 load() 가 같은 내용', S.load(), sample);

  const dirty = JSON.parse(JSON.stringify(sample));
  dirty.address = '경산시 어딘가'; dirty.name = '홍길동'; dirty.studentId = '22000000';
  dirty.commute.homeLat = 35.8; dirty.classes[0].phone = '010-0000-0000';
  S.save(dirty);
  const stored = mem['wakeup.v1'];
  check('개인정보 필드는 저장되지 않음', ['경산시', '홍길동', '22000000', 'homeLat', '010-'].map(s => stored.includes(s)), [false, false, false, false, false]);

  const bad = JSON.parse(JSON.stringify(sample));
  bad.classes[0].end = '08:00'; bad.commute.prepMin = '';
  const r2 = S.save(bad);
  check('잘못된 입력은 저장 거부 + 오류 위치', [r2.ok, r2.errors.map(e => e.scope + '.' + e.field)], [false, ['classes.end', 'commute.prepMin']]);
  check('거부돼도 이전 저장본 유지', S.load().classes[0].end, '10:15');

  const noRoute = JSON.parse(JSON.stringify(sample)); noRoute.commute.routeId = '';
  check('노선 미선택 거부', S.validate(noRoute).map(e => e.field), ['routeId']);

  const notif = JSON.parse(JSON.stringify(sample)); notif.notify.enabled = true; notif.notify.topic = '공백 있음';
  check('알림 켰을 때 토픽 형식 검사', S.validate(notif).map(e => e.field), ['topic']);

  mem['wakeup.v1'] = '{깨진 json';
  check('저장본이 깨졌으면 null', S.load(), null);
  S.clear();
  check('clear() 후 null', S.load(), null);

  // bus
  const routes = await B.loadRoutes();
  check('노선 목록 3개', routes.map(r => r.id), ['route-a', 'route-b', 'route-c']);
  const ra = await B.loadRoute('route-a');
  check('route-a 불러오기 (소요 40분, 예시 표시)', [ra.rideMin, B.routeLabel(ra)], [40, '예시 노선 A (예시 데이터)']);
  let err = null; try { await B.loadRoute('../../etc/passwd'); } catch (e) { err = e.message; }
  check('목록에 없는 노선 id 거부', !!err && err.includes('찾을 수 없어요'), true);

  const custom = { rideMin: 30, weekday: ['07:50', '08:20'], saturday: [], sunday: [] };
  const rc = await B.resolveRoute({ customTimes: custom, routeId: 'route-a' });
  check('직접 입력 시각이 노선 선택보다 우선', [rc.id, rc.rideMin], ['custom', 30]);
  const badCustom = JSON.parse(JSON.stringify(sample)); badCustom.commute.customTimes = { rideMin: 30, weekday: ['08:20', '07:50'], saturday: [], sunday: [] };
  check('직접 입력 시각 역순이면 거부', S.validate(badCustom).map(e => e.scope), ['route']);

  // 통합: 예시 시간표 + route-a → 주간 기상 시각
  const route = await B.resolveRoute(sample.commute);
  const week = C.calcWeek(sample.classes, sample.commute, route);
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  const summary = week.map(d => names[d.day] + ' ' + (d.status === 'no-class' ? '수업없음' : T.label(d.wake) + '/' + T.label(d.bus)));
  console.log('     주간: ' + summary.join(' · '));
  check('통합: 월요일 07:20 기상 · 08:05 버스', summary[1], '월 07:20/08:05');

  console.log(`==> ${pass} / ${pass + fail} PASS ${fail ? '❌' : '✅'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
