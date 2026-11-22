"""calc.py 와 site/js/calc.js 가 calc_cases.json 에 대해 같은 결과를 내는지 확인한다.

실행: python3 /root/wakeup/server/test_calc.py
  - calc.py 결과를 기대값과 비교
  - node 가 있으면 calc.js 도 같은 케이스로 돌려 기대값과 비교 (두 언어 결과 일치 확인)
"""

import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import calc  # noqa: E402

CASES = os.path.join(HERE, "calc_cases.json")
SITE_JS = os.path.join(HERE, "..", "site", "js")
TIME_KEYS = {"bus", "departure", "wake", "boardLimit", "arriveTarget", "classStart", "nextBus", "arrival"}

# calc.js 를 같은 케이스로 돌리는 node 코드 (결과를 JSON 으로 출력)
JS_RUNNER = r"""
const path = require('path');
const T = require(path.join(process.argv[1], 'time.js'));
const C = require(path.join(process.argv[1], 'calc.js'));
const spec = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const out = spec.cases.map(c => {
  const commute = Object.assign({}, spec.commute, c.commute || {});
  const route = spec.routes[c.route];
  const classes = c.classes.map((x, i) => Object.assign({ id: 'c' + i, name: '', room: '' }, x));
  const r = C.calcDay(classes, commute, route, c.day);
  const res = c.fn === 'checkNow' ? C.checkNow(r, commute, route, T.toMin(c.now)) : r;
  const pick = {};
  for (const k of Object.keys(c.expect)) pick[k] = res[k];
  return pick;
});
console.log(JSON.stringify(out));
"""


def run_py(spec):
    out = []
    for c in spec["cases"]:
        commute = {**spec["commute"], **c.get("commute", {})}
        route = spec["routes"][c["route"]]
        classes = [{"id": f"c{i}", "name": "", "room": "", **x} for i, x in enumerate(c["classes"])]
        r = calc.calc_day(classes, commute, route, c["day"])
        res = calc.check_now(r, commute, route, calc.to_min(c["now"])) if c["fn"] == "checkNow" else r
        out.append({k: res.get(k) for k in c["expect"]})
    return out


def run_js():
    node = shutil.which("node")
    if not node:
        return None
    p = subprocess.run([node, "-e", JS_RUNNER, os.path.abspath(SITE_JS), CASES],
                       capture_output=True, text=True, timeout=30)
    if p.returncode != 0:
        raise RuntimeError("calc.js 실행 실패: " + p.stderr.strip())
    return json.loads(p.stdout)


def normalize(result):
    """시각 값(분)을 label 형식으로 바꿔 기대값과 비교할 수 있게"""
    return {k: (calc.label(v) if k in TIME_KEYS and isinstance(v, int) else v) for k, v in result.items()}


def main():
    with open(CASES, encoding="utf-8") as f:
        spec = json.load(f)
    py = run_py(spec)
    js = run_js()
    passed = failed = 0
    for i, c in enumerate(spec["cases"]):
        exp = c["expect"]
        got_py = normalize(py[i])
        ok_py = got_py == exp
        line = f"{c['name']}"
        problems = []
        if not ok_py:
            problems.append(f"py 기대 {exp} / 실제 {got_py}")
        if js is not None:
            got_js = normalize(js[i])
            if got_js != exp:
                problems.append(f"js 기대 {exp} / 실제 {got_js}")
        if problems:
            failed += 1
            print("FAIL", line)
            for p in problems:
                print("     ", p)
        else:
            passed += 1
            print("PASS", line, "(py · js 일치)" if js is not None else "(py)")
    if js is None:
        print("※ node 가 없어 calc.js 비교는 건너뜀")
    total = passed + failed
    print(f"==> {passed} / {total} PASS", "✅" if not failed else "❌")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
