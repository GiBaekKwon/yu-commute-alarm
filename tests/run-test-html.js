// site/test.html 의 PASS/FAIL 을 브라우저 없이 확인 (Node.js 만 필요)
// 실행: TZ=Asia/Seoul node tests/run-test-html.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const site = path.join(__dirname, '..', 'site');
const html = fs.readFileSync(path.join(site, 'test.html'), 'utf8');
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function el() { return { children: [], className: '', textContent: '', appendChild(c) { this.children.push(c); } }; }
const nodes = { results: el(), summary: el() };
const ctx = { Date, JSON, Math, console, document: {
  title: '', getElementById: id => nodes[id], createElement: () => el(), createTextNode: s => ({ textContent: s }) } };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const s of srcs) vm.runInContext(fs.readFileSync(path.join(site, s.split('?')[0]), 'utf8'), ctx, { filename: s });
vm.runInContext(inline, ctx);
for (const li of nodes.results.children) {
  console.log(li.children.map(c => c.textContent).join(''));
}
console.log('==>', nodes.summary.textContent);
process.exit(nodes.summary.className === 'pass' ? 0 : 1);
