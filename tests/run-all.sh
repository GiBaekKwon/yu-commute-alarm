#!/bin/sh
# 영남대 통학 기상 알리미 — 전체 테스트 (사용법: tests/README.md)
#   sh tests/run-all.sh                       브라우저 없이 되는 검사 전부
#   CHROME_PATH=... sh tests/run-all.sh       + 모바일 화면(헤드리스 크롬) 검사
cd "$(dirname "$0")" || exit 1
export TZ=Asia/Seoul
[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1
FAILED=""
run() { name="$1"; shift; printf '%-28s ' "$name"; out=$("$@" 2>&1); code=$?; echo "$out" | tail -1; [ $code -eq 0 ] || { FAILED="$FAILED $name"; echo "$out" | grep -E 'FAIL|기대|실제|Error' | head -20; }; }

run "JS·CSS 버전 표시"        node version.test.js
run "에타 가져오기(서버)"      python3 test_import.py
run "저장 API"                python3 test_api.py
run "길찾기 API(합성)"         python3 test_route.py
run "통학 계산 py·js 일치"     python3 ../server/test_calc.py
run "전날 밤 알림"             python3 test_notify.py
run "test.html (계산·알림)"   node run-test-html.js
run "저장·버스"               node storage-bus.test.js
run "대시보드(등록·알림)"      node dashboard.test.js
run "설정 화면"               node setup.test.js
run "첫 페이지"               node start.test.js

# 동기화: 임시 데이터 폴더로 API 를 5199 포트에 띄워 검사 (실제 서버 데이터는 건드리지 않음)
TMP=$(mktemp -d)
WAKEUP_PORT=5199 WAKEUP_DATA_DIR="$TMP" python3 ../server/app.py >"$TMP/server.log" 2>&1 &
PID=$!; sleep 1.5
run "동기화(두 기기)"          node sync.test.js http://127.0.0.1:5199/api/
kill $PID 2>/dev/null

if [ -n "$CHROME_PATH" ]; then
  run "모바일 360·400px"        node mobile.test.js
else
  echo "모바일 360·400px           건너뜀 (CHROME_PATH 없음 — README 참고)"
fi

if [ -n "$FAILED" ]; then echo "❌ 실패:$FAILED"; exit 1; fi
echo "✅ 모두 통과"
