# tests — 영남대 통학 기상 알리미 검사

`site/` 배포에는 포함되지 않는다. `sh tests/run-all.sh` 로 전부 실행.

| 파일 | 확인하는 것 (plan.md A-6) |
|---|---|
| `test_import.py` | 에타 공개 링크 → 시간표 변환 (5분 단위 · 요일 · 강의실 · 시간 없는 과목 제외 · 이름/교수명 미포함), 실패 안내(잘못된 주소 · 없는 시간표 · 비공개 · 빈 학기 · 에타 무응답 · 요청 과다) |
| `run-test-html.js` | `site/test.html` 전 항목 (기상 계산 + **10분 경계** · 다음 수업) |
| `dashboard.test.js` | 첫 방문 예시 → 등록 → 미리보기 → 저장 → **재접속** → 다시 등록(교체) / **10분 전 배너 · 7분 전에 열기 · 시작 후 미표시 · 중복 알림 없음 · 다음 날 다시** / 예시 체험 · `?demo=9` / 크롬 확장 연결 코드 만들기 · 재접속 유지 · 서버 실패 안내 / 통학 시간 계산(2호선 대체 · 직접 입력 · 저장 · 통학 띠 3상태 · 단축어용 복사 · 체험) |
| `mobile.test.js` | 헤드리스 크롬 360 · 400px: 가로 스크롤 없음, 순서(다음 수업 → 오늘 → 주간), 버튼 크기, 10분 전 배너가 카운트다운 바로 위 · 스크롤해도 고정, 1100px 2열, 스크린샷 `screenshots/` |
| `setup.test.js` · `storage-bus.test.js` · `sync.test.js` · `test_api.py` · `test_notify.py` | 설정 화면 · 저장 · 동기화 · 서버 API · 전날 밤 알림 (부가 기능) |
| `fixtures/everytime-public.xml` | 실제 공개 링크 응답(2026-11-21 확인)과 **같은 구조의 가짜 데이터** (실제 사용자 시간표 아님) |

## 실제 에타 링크로 확인 (구조가 바뀌었는지 볼 때)
```bash
python3 tests/test_import.py --live https://everytime.kr/@<공개 링크>
```
원문은 저장 · 출력하지 않고 변환 결과(요일 · 시각 · 과목 · 강의실)만 보여 준다.

## 모바일 화면 검사 준비 (한 번)
서버에 크롬이 없으면 Playwright 크롬을 받아 쓴다. 시스템에 설치하지 않으려면 부족한 라이브러리를 `apt-get download` + `dpkg -x` 로 임의 폴더에 풀고 `LD_LIBRARY_PATH` 로 지정한다.
```bash
PLAYWRIGHT_BROWSERS_PATH=~/pw npx playwright@1.48.2 install chromium
CHROME_PATH=~/pw/chromium-1140/chrome-linux/chrome LD_LIBRARY_PATH=<풀어 둔 lib 폴더> sh tests/run-all.sh
```

## 발표 · 테스트용 10분 전 알림 재현 (plan.md A-4)
1. `http://<공인 IP>/wakeup/` → **[예시 시간표로 체험]** → **[알림 바로 확인]**
   → 9분 뒤 시작하는 "알림 체험 수업"이 오늘 시간표에 추가되고 **카운트다운 바로 위 주황 배너가 즉시** 뜬다 ("8분 ○○초 뒤 시작해요"). 스크롤해도 화면 위에 붙어 있다.
2. 바로 열기: `http://<공인 IP>/wakeup/?demo=9` (N = 1~10분)
3. 중복 확인: 새로고침해도 같은 체험 수업 배너는 다시 안 뜸 → [알림 바로 확인]을 다시 누르면 새 체험 수업이라 다시 뜸.
4. 실제 시간표로 보려면: 수업 시작 10분 전 ~ 시작 전 사이에 대시보드를 열어 둔다 (탭 제목에도 🔔 표시).
