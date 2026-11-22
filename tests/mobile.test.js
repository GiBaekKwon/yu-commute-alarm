// 모바일 화면 검사 — 헤드리스 크롬 (plan.md A-6)
// 360 · 400px: 가로 스크롤 없음 · 카드 순서(다음 수업 → 오늘 → 주간) · 버튼 크기 · 스크린샷
// 실행: CHROME_PATH=<크롬 실행 파일> [LD_LIBRARY_PATH=...] TZ=Asia/Seoul node mobile.test.js
// 스크린샷: tests/screenshots/*.png
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const SITE = path.join(__dirname, '..', 'site');
const OUT = path.join(__dirname, 'screenshots');
const IMPORT_OK = fs.readFileSync(path.join(__dirname, 'fixtures', 'import-result.json'), 'utf8');
const PORT = 5198;
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `\n     기대 ${JSON.stringify(expected)}\n     실제 ${JSON.stringify(actual)}`));
}

// 배너가 내려오는 애니메이션(0.25초)이 끝난 뒤 찍기
async function settled(page) {
  await page.waitForFunction(() => { const e = document.getElementById('alert-banner'); return !e || e.getAnimations().length === 0; });
}

async function layout(page) {
  return page.evaluate(() => {
    const vis = el => el && !el.classList.contains('hidden') && el.offsetParent !== null;
    const top = id => { const e = document.getElementById(id); return vis(e) ? Math.round(e.getBoundingClientRect().top + scrollY) : null; };
    const small = [...document.querySelectorAll('button, .btn, input:not([type=checkbox]), select')]
      .filter(vis).filter(e => e.getBoundingClientRect().height < 36).map(e => (e.id || e.textContent.trim()).slice(0, 20));
    return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
             next: top('next-card'), today: top('today-card'), week: top('week-card'), small };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', SITE], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const base = `http://127.0.0.1:${PORT}/`;
  try {
    for (const width of [360, 400]) {
      const ctx = await browser.newContext({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push(e.message));
      await page.clock.install({ time: new Date('2026-11-23T10:23:00+09:00') });   // 월요일, 10:30 수업 7분 전
      await page.route('**/api/import/everytime', async route => {
        const url = JSON.parse(route.request().postData()).url;
        if (url.includes('private')) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: "공개되지 않은 시간표예요. 에타 시간표 설정에서 공개 범위를 '전체 공개'로 바꾼 뒤 다시 시도해 주세요.", reason: 'private' }) });
        return route.fulfill({ status: 200, contentType: 'application/json', body: IMPORT_OK });
      });
      await page.route('**/api/profile/**', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));

      // 0. 첫 페이지 (11/21): 처음 온 사람은 index.html → start.html 로 이동 → [시작하기] → 대시보드
      await page.goto(base + 'index.html');
      await page.waitForURL('**/start.html');
      let L = await layout(page);
      const cta = await page.locator('#start').boundingBox();
      check(`${width}px 첫 페이지: 처음 오면 start.html · 가로 스크롤 없음 · 시작하기 버튼 첫 화면 안 (높이 760)`, [page.url().endsWith('/start.html'), L.scrollW <= L.innerW, cta.y + cta.height <= 760, cta.height >= 48], [true, true, true, true]);
      check(`${width}px 첫 페이지: 누르기 작은 버튼 없음`, L.small, []);
      await page.screenshot({ path: path.join(OUT, `${width}-0-start.png`), fullPage: true });
      await page.click('#start');
      await page.waitForURL('**/index.html');

      // 1. 첫 방문 (시작하기 뒤 대시보드: 예시 시간표)
      await page.waitForSelector('#week-card:not(.hidden) .tt-block');
      L = await layout(page);
      check(`${width}px 첫 방문: 가로 스크롤 없음`, L.scrollW <= L.innerW, true);
      check(`${width}px 첫 방문: 누르기 작은 버튼 없음 (36px 미만)`, L.small, []);
      await page.screenshot({ path: path.join(OUT, `${width}-1-first-visit.png`), fullPage: true });

      // 2. 가져오기 실패 (비공개)
      await page.click('#btn-register');
      await page.fill('#import-url', 'https://everytime.kr/@privateLink');
      await page.click('#import-go');
      await page.waitForSelector('#import-error:not(.hidden)');
      L = await layout(page);
      check(`${width}px 가져오기 실패: 가로 스크롤 없음`, L.scrollW <= L.innerW, true);
      await page.locator('#register').screenshot({ path: path.join(OUT, `${width}-2-import-private.png`) });

      // 3. 가져오기 성공 → 미리보기
      await page.fill('#import-url', 'https://everytime.kr/@okLink');
      await page.click('#import-go');
      await page.waitForSelector('#import-preview:not(.hidden)');
      L = await layout(page);
      check(`${width}px 미리보기: 가로 스크롤 없음`, L.scrollW <= L.innerW, true);
      await page.locator('#register').screenshot({ path: path.join(OUT, `${width}-3-import-preview.png`) });

      // 4. 저장 → 대시보드 + 10분 전 배너 (7분 전)
      await page.click('#import-save');
      await page.waitForSelector('#alert-banner:not(.hidden)');
      await settled(page);
      L = await layout(page);
      check(`${width}px 대시보드: 가로 스크롤 없음`, L.scrollW <= L.innerW, true);
      check(`${width}px 대시보드: 모바일 순서 다음 수업 → 오늘 남은 수업 → 주간 시간표`, L.next < L.today && L.today < L.week, true);
      check(`${width}px 대시보드: 누르기 작은 버튼 없음`, L.small, []);
      check(`${width}px 주간 시간표: 칸 안 시각이 한 줄 (줄바꿈 없음)`, await page.$$eval('.tt-time', els => els.filter(e => e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).lineHeight) * 1.5).length), 0);
      const near = await page.evaluate(() => {
        const b = document.getElementById('alert-banner').getBoundingClientRect(), n = document.getElementById('next-card').getBoundingClientRect();
        return { gap: Math.round(n.top - b.bottom), inView: b.top >= 0 && b.bottom <= innerHeight };
      });
      check(`${width}px 배너가 카운트다운(다음 수업 카드) 바로 위에 첫 화면 안에 보임`, [near.gap >= 0 && near.gap <= 16, near.inView], [true, true]);
      check(`${width}px 배너 내용 (헤드리스 시계가 실제로 흘러 1초 차이 허용)`, /^자료구조 · E21-101 (7분 0초|6분 5\d초) 뒤 시작해요$/.test(await page.textContent('#alert-banner .alert-text').then(t => t.replace(/\s+/g, ' ').trim())), true);
      await page.screenshot({ path: path.join(OUT, `${width}-4-dashboard-alert.png`) });
      await page.screenshot({ path: path.join(OUT, `${width}-5-dashboard-full.png`), fullPage: true });
      // 주간 시간표까지 내려도 배너는 화면 위에 붙어 있음 (sticky)
      await page.evaluate(() => document.getElementById('week-card').scrollIntoView({ block: 'start' }));
      const stuck = await page.evaluate(() => Math.round(document.getElementById('alert-banner').getBoundingClientRect().top));
      check(`${width}px 주간 시간표로 스크롤해도 배너가 화면 위에 고정`, stuck >= 0 && stuck <= 12, true);
      await page.screenshot({ path: path.join(OUT, `${width}-7-scrolled-sticky.png`) });
      await page.evaluate(() => scrollTo(0, 0));

      // 5. 재접속 (새로 열기) → 같은 알림 안 뜸
      await page.reload();
      await page.waitForSelector('#next-card:not(.hidden)');
      check(`${width}px 재접속: 내 시간표 바로 표시 · 같은 수업 알림 다시 안 뜸`, [await page.textContent('#btn-register').then(t => t.replace(/\s+/g, ' ').trim()), await page.isHidden('#alert-banner')], ['시간표 다시 등록', true]);

      // 5-1. 크롬 확장 연결 줄 펼치기 (코드 만들기 전 상태)
      await page.click('#ext-card summary');
      L = await layout(page);
      check(`${width}px 확장 연결 펼침: 가로 스크롤 없음 · 작은 버튼 없음`, [L.scrollW <= L.innerW, L.small], [true, []]);
      await page.locator('#ext-card').screenshot({ path: path.join(OUT, `${width}-8-extension.png`) });

      // 5-2. 통학 시간 계산 → 저장 → 다음 수업 아래 통학 띠 · 통학 계획 (월 10:23, 10:30 수업)
      await page.click('#next-body [data-action="commute"]');
      await page.fill('#cm-from', '반월당');
      await page.fill('#cm-prep', '40');
      await page.fill('#cm-buffer', '10');
      await page.click('#cm-calc');
      await page.waitForSelector('#cm-result:not(.hidden)');
      check(`${width}px 통학: 길찾기 연결 전 → 2호선 시각표로 27분`, await page.inputValue('#cm-travel'), '27');
      L = await layout(page);
      check(`${width}px 통학 계산 패널: 가로 스크롤 없음 · 작은 버튼 없음`, [L.scrollW <= L.innerW, L.small], [true, []]);
      await page.locator('#commute-card').screenshot({ path: path.join(OUT, `${width}-9-commute-form.png`) });
      await page.click('#cm-save');
      await page.waitForSelector('#next-body .cstrip:not(.is-cta)');
      check(`${width}px 통학 띠: 출발 시각(09:53) 지남 → 지금 나가면 도착 · 지각 안내`, await page.textContent('#next-body .cstrip .cs-title'), '출발 시각 09:53이 지났어요');
      L = await layout(page);
      check(`${width}px 통학 저장 후: 가로 스크롤 없음 · 순서 유지 (다음 수업 → 오늘 → 주간 → 통학 계획)`, [L.scrollW <= L.innerW, L.next < L.today && L.today < L.week && L.week < await page.evaluate(() => Math.round(document.getElementById('commute-card').getBoundingClientRect().top + scrollY))], [true, true]);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(OUT, `${width}-10-commute-strip.png`) });
      await page.locator('#commute-card').screenshot({ path: path.join(OUT, `${width}-11-commute-plan.png`) });

      // 6. 설정 화면
      await page.goto(base + 'setup.html');
      await page.waitForSelector('.class-item');
      L = await layout(page);
      check(`${width}px 설정 화면: 가로 스크롤 없음`, L.scrollW <= L.innerW, true);

      // 7. 예시 체험 + 알림 재현 (?demo=9)
      const page2 = await ctx.newPage();
      await page2.clock.install({ time: new Date('2026-11-25T14:31:00+09:00') });
      await page2.route('**/api/profile/**', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
      await page2.goto(base + 'index.html?demo=9');
      await page2.waitForSelector('#alert-banner:not(.hidden)');
      await settled(page2);
      L = await layout(page2);
      check(`${width}px 체험(?demo=9): 배너 · 가로 스크롤 없음`, [await page2.textContent('#alert-left'), L.scrollW <= L.innerW], ['9분 0초', true]);
      await page2.screenshot({ path: path.join(OUT, `${width}-6-demo-alert.png`) });
      check(`${width}px 스크립트 오류 없음`, errs, []);
      await ctx.close();
    }

    // 넓은 화면 2열 배치
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, timezoneId: 'Asia/Seoul' });
    const page = await ctx.newPage();
    await page.clock.install({ time: new Date('2026-11-23T10:23:00+09:00') });
    await page.route('**/api/profile/**', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
    await page.goto(base + 'index.html?demo=8');
    await page.waitForSelector('#alert-banner:not(.hidden)');
    await settled(page);
    const pos = await page.evaluate(() => ['next-card', 'today-card', 'week-card'].map(id => Math.round(document.getElementById(id).getBoundingClientRect().left)));
    check('1100px: 넓은 화면은 2열 (다음 수업 · 오늘 왼쪽, 주간 오른쪽)', pos[0] === pos[1] && pos[2] > pos[0], true);
    const gap = await page.evaluate(() => Math.round(document.getElementById('today-card').getBoundingClientRect().top - document.getElementById('next-card').getBoundingClientRect().bottom));
    check('1100px: 다음 수업과 오늘 카드 사이 빈 공간 없음 (간격 ≤ 20px)', gap <= 20, true);
    await page.screenshot({ path: path.join(OUT, '1100-desktop.png'), fullPage: true });
    await ctx.close();
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`==> ${pass} / ${pass + fail} PASS ${fail ? '❌' : '✅'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
