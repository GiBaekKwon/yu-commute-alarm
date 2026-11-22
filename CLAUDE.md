# CLAUDE.md — 영남대 통학 기상 알리미

**메인 (11/21 개편)**: 에브리타임 공개 공유 링크로 시간표를 한 번 등록하면 대시보드에서 다음 수업 · 오늘 남은 수업 · 주간 시간표를 보고, 대시보드를 열어 두면 **수업 10분 전 화면 배너 알림**을 받는 웹.
**부가**: 통학 계획(요일별 기상 · 출발 시각 계산, 대시보드 하단 접힘) · 전날 밤 ntfy 알림 · 크롬 확장(팀원 담당).
이전 계획과 다르면 `plan.md` A장(메인 기능)을 따른다. 실제 기상 알람은 사용자 폰 몫이다.

- 기획서: `docs/project-plan-wakeup.md`
- 개발 계획: `plan.md` (데이터 형식 · 경계 상황 · 단계별 확인 방법은 여기를 따른다)

## 반드시 지킬 규칙
1. **순수 HTML · CSS · JS만** 쓴다. 외부 라이브러리 · CDN · 웹폰트 링크 금지. `<script src>`는 `site/js/` 안의 파일만 (`extension/`은 아래 확장 프로그램 규칙을 따른다).
   - **예외 (11/21 결정)**: `site/js/vendor/qrcode.js` = qrcode-generator 2.0.4 (MIT) 파일 복사본 — 아이폰 단축어 QR 생성용. CDN이 아니라 서버에 있는 파일이고 외부로 요청하지 않는다. 새 vendor 파일은 사람 승인 후에만 추가한다.
2. **개인정보 저장 금지**: 집 주소 · 좌표 · 이름 · 학번 · 전화번호 필드를 만들지 않는다. 통학은 걸리는 시간(분)만 저장한다.
3. **에타 연동은 공개 공유 링크만**: 사용자가 붙여 넣은 `https://everytime.kr/@식별자`를 서버(`server/everytime.py`)가 로그인 없이 1회 읽는다. 계정 · 비밀번호 · 쿠키는 받지 않는다. 요청은 `friendInfo=false`(사용자 이름 미수신), 결과는 과목명 · 요일 · 시각 · 강의실만. 가져온 내용은 미리보기 후 사용자가 **"시간표 저장"을 눌러야** 반영한다. 응답 구조를 바꿀 때는 실제 공개 링크로 다시 확인한다(`python3 tests/test_import.py --live <URL>`).
4. **모바일 우선**: 400px · 360px 폭에서 가로 스크롤이 생기지 않아야 한다.
5. **추측 금지**: 실제 버스 노선 번호 · 시각, 서버 포트 · IP 등 확인되지 않은 값은 지어내지 않는다. 모르면 `plan.md` 8장 질문 목록에 추가하고 사람에게 묻는다.
6. `calc.js` · `classes.js` · `commute.js`는 DOM에 접근하지 않는 순수 함수로 유지한다. 계산 · 알림 규칙을 바꾸면 `test.html` 케이스도 함께 고친다.
7. **수업 10분 전 알림**: `0 < 시작 − 지금 ≤ 10분`인 오늘 수업만, 이미 시작한 수업은 건너뛰고, 같은 수업은 당일 한 번만(`localStorage["wakeup.alerted"]`). 자세한 규칙은 `plan.md` A-3.

## 기상 시각 계산 규칙
```
도착 목표 = 그날 첫 수업 시작 − 하차 후 강의실 도보 − 여유 시간
탑승 한계 = 도착 목표 − 버스 소요 시간
탈 버스   = 그날 요일 유형(평일/토/일) 시각 중 탑승 한계 이하인 가장 늦은 버스
출발 시각 = 탈 버스 − 집→정류장 도보
기상 시각 = 출발 시각 − 준비 시간
```
- 기준 예시(테스트 1번): 09:00 수업, 강의실 도보 8분, 버스 40분, 정류장 도보 5분, 준비 40분 → **08:05 버스 → 07:20 기상**
- 시각은 `"HH:MM"`(24시간제), 길이는 분(정수), 요일은 `0=일 … 6=토` (JS `getDay()`와 같음)
- 내부 계산은 "그날 0시 기준 분". 음수면 전날(자정 넘김)로 표시한다.
- 경계 상황(수업 없는 날 · 공강 · 첫차 지각 · 버스 놓침 · 막차 놓침 · 자정 넘김 · 입력 오류)의 처리는 `plan.md` 3장 표를 따른다.

## 폴더 구조
```
site/            정적 웹 → /var/www/html/wakeup/ 로 그대로 복사
  start.html     첫 페이지 (소개 + [시작하기]) — 처음 온 사람만 index.html 의 js/gate.js 가 여기로 보냄 (시간표 · 동기화 코드 · 시작 기록 없을 때, ?demo= 주소 제외)
  index.html     대시보드 (첫 방문 예시 · 에타 등록 · 다음 수업 · 오늘 · 주간 · 10분 전 배너 · 통학 띠 · 통학 계획/계산 · 크롬 확장 연결 코드)
  setup.html     설정 (수업 직접 편집 · 동기화 — 통학 입력은 대시보드로 옮김, 전날 밤 알림 카드는 11/21 없앰)   week.html  → 대시보드로 이동
  test.html      계산 · 알림 규칙 테스트 (PASS/FAIL)
  css/style.css
  js/            gate.js · start.js · time.js · calc.js · classes.js · commute.js · storage.js · bus.js · dashboard.js · setup.js · nav.js
  data/          sample-timetable.json, bus/routes.json, bus/route-*.json, subway/line2.json (server/build_subway.py 로 생성)
server/          Flask (app.py · everytime.py 에타 가져오기 · calc.py · notify.py) — API 127.0.0.1:5100, Nginx /wakeup/api/, 데이터 /var/lib/wakeup-api/profiles/ (배포 · 커밋 제외)
extension/       4단계 크롬 확장 (선택) — manifest.json · popup.html/css/js · js/schedule.js · sample-profile.json
```
- `site/` 안의 경로는 모두 **상대 경로**로 쓴다 (`/wakeup/` 아래에서 동작해야 함).

## 크롬 확장 프로그램 (`extension/`)
- 팝업 범위: 다음 수업 카운트다운 · 오늘 남은 수업 · 미니 시간표. **기상 시각 · 버스 · 도보는 넣지 않는다** (자세한 상황 표는 `plan.md` 4단계).
- MV3. 원격 코드 금지 → `<script src>`는 `extension/` 안의 파일만, 외부 CDN 금지. 서버 주소는 `host_permissions`에만 쓴다.
- `js/schedule.js`는 DOM · `chrome.*` API에 접근하지 않는 순수 함수로 유지한다. 입력은 `plan.md` 2-1 프로필 형식 그대로.
- 확장 작업 중에는 `site/` · `server/`를 수정하지 않는다 (웹과 같은 로직은 나중에 하나로 합친다).
- 등록 · 수정 기능은 넣지 않는다. 데이터는 서버 API에서 읽고 `chrome.storage.local`에 캐시한다.
- 수업 N분 전 PC 알림은 `background.js`(`chrome.alarms` · `chrome.notifications`)가 담당한다. 서버의 전날 밤 기상 알림(`notify.py`)과 별개이며, 기상 시각 · 버스를 쓰지 않는다.
- 확인: `node extension/test/schedule.test.js` → 전 항목 PASS

## 확인 명령
- 전체 테스트: `tests/run-all.sh` (사용법 `tests/README.md`) — 에타 가져오기 · 저장 후 재접속 · 10분 경계 · 중복 알림 · 모바일 360/400px
- 계산: 브라우저에서 `site/test.html` 열어 전 항목 PASS
- JSON 형식: `python3 -m json.tool site/data/bus/route-a.json`
- 외부 링크 검사: `grep -rn "http" site/` → CDN · 외부 주소가 없어야 함 (예외: `js/vendor/qrcode.js` 주석 · SVG 이름공간, `dashboard.js`의 단축어 iCloud 설치 링크 `SHORTCUT_INSTALL_URL`)
- 배포 후: `curl -I http://<공인 IP>/wakeup/` → 200
- 확장: `python3 -m json.tool extension/manifest.json` · `grep -rn "http" extension/` → `host_permissions` · 서버 API 주소 외에 없어야 함

## 배포 (`/var/www/html/wakeup/`) — **`sh deploy.sh` 로만** (손으로 cp 금지, 11/21)
여러 사람이 같은 서버 · 같은 폴더에서 고치므로 배포가 섞이지 않게 스크립트 하나로만 올린다.
```bash
sh deploy.sh --check   # 검사 + 바뀌는 파일 목록만 (배포 안 함)
sh deploy.sh           # 검사 → 전체 테스트 → 목록 확인(y) → 백업 → 배포 → 기록
```
- Claude는 **`/site-deploy` 스킬**로 배포한다: deploy.sh 가 안 보는 외부 주소 · 확장 zip 최신(`site/download/wakeup-extension.zip` ↔ `extension/`)을 먼저 점검 → `deploy.sh --check` → 사용자 확인 → `deploy.sh --yes`.
- **JS · CSS를 고쳤으면 `site/*.html`의 `?v=` 값을 새 값으로 올린다.** 안 올리면 deploy.sh 가 멈춘다 (브라우저 캐시 때문에 예전 파일이 섞여 보임, 11/21 실제 사례).
- deploy.sh 가 멈추는 경우: 다른 사람이 배포 중(잠금) · 배포본이 손으로 바뀜(지문 불일치 → 팀 확인 후 `--force`) · `?v=` 안 올림 · 테스트 실패 · 테스트 중 `site/` 가 바뀜(누가 고치는 중).
- 기록: `/var/lib/wakeup-deploy/deploy.log` (시각 · 사람 · 버전 · 파일 수 · 백업 이름). 마지막 테스트 로그: `last-test.log`.
- 지우지 않는다 (`rm -rf` · `rsync --delete` 없음). 배포본에만 있는 파일(예: `start-preview.html`, 옛 `js/today.js · week.js`)은 그대로 남는다.

## 서버 안전 규칙
- `/var/www/html`의 기존 파일을 수정하기 전에 백업본을 만든다.
- `/var/www/html/index_day1.html`은 수정 · 삭제하지 않는다.
- `rm -rf`, SSH 설정, 방화벽, 사용자 계정 · 비밀번호 변경은 하지 않는다.
- Nginx 설정을 바꿀 때는 백업 → 수정 → `sudo nginx -t` 통과 → `sudo systemctl reload nginx` 순서로 한다.
- 오래된 `wakeup.bak-*` 폴더가 쌓이지 않게 정리 여부를 사람에게 묻는다 (디스크 부족 방지).
