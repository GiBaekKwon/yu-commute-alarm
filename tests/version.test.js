// 브라우저 캐시 때문에 예전 JS · CSS 가 섞이지 않게: 모든 페이지의 js/ · css/ 주소에 같은 ?v= 버전이 붙어 있는지
// (11/21 실제 사례: 예전 storage.js 가 캐시에 남아 에타 가져오기가 동작하지 않음)
// JS · CSS 를 고쳐 배포할 때는 site/*.html 의 ?v= 값을 함께 올린다.
const fs = require('fs'), path = require('path');
const SITE = path.join(__dirname, '..', 'site');
let bad = [], versions = new Set();
for (const f of fs.readdirSync(SITE).filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(SITE, f), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)) {
    const v = /\?v=([\w-]+)$/.exec(m[1]);
    if (!v) bad.push(`${f}: ${m[1]}`); else versions.add(v[1]);
  }
}
const ok = bad.length === 0 && versions.size <= 1;
console.log(ok ? `PASS 모든 페이지 js · css 에 같은 버전 (${[...versions].join(',') || '없음'})` : `FAIL 버전 없음: ${bad.join(', ')} / 버전 종류: ${[...versions].join(',')}`);
console.log(`==> ${ok ? 1 : 0} / 1 PASS ${ok ? '✅' : '❌'}`);
process.exit(ok ? 0 : 1);
