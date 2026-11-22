---
name: ext-check
description: 크롬 확장 프로그램(extension/) 점검 — 로직 테스트 · JSON · JS 문법 · 파일 참조 · 외부 주소 · 서버 주소 일치를 검사하고, 모두 통과하면 manifest 버전을 올린 뒤 PC로 받아 갈 scp 명령을 알려 준다. 확장 코드를 고친 뒤 PC 크롬에 반영하기 전에 사용.
---

# ext-check — 크롬 확장 점검 후 PC 반영 안내

## 실행
1. 프로젝트 루트(`/root/wakeup`)에서 점검 스크립트를 실행한다.
   - 기본: `python3 .claude/skills/ext-check/check.py --bump`
   - 인자에 `no-bump`가 있으면: `python3 .claude/skills/ext-check/check.py` (버전 그대로)
2. 스크립트가 하는 일 (직접 다시 검사하지 말고 결과를 믿는다)
   - 로직 테스트(`extension/test/schedule.test.js`), JSON 형식, JS 문법, 파일 참조, 외부 주소, `config.js` ↔ `host_permissions` 일치
   - 모두 통과 + `--bump`일 때만 `manifest.json` 패치 버전 +1 (예: 0.2.0 → 0.2.1)
   - 마지막 점검 이후 바뀐 파일 목록 (`last-check.json` 해시 비교)

## 실패했을 때
- 실패 항목과 원인을 짧게 보여 주고 고치는 방법을 제안한다. 사용자가 원하면 고친 뒤 이 스킬을 다시 실행한다.
- 버전은 올라가지 않는다 (스크립트가 처리).
- 확장 작업 규칙 그대로: `site/` · `server/`는 수정하지 않는다 (CLAUDE.md "크롬 확장 프로그램").

## 보고 형식 (한국어, 짧게)
1. 결과 한 줄: 모두 통과 / 실패 N개
2. 항목별 PASS · FAIL 표 (실패만 설명)
3. 버전 변화 · 바뀐 파일
4. 통과했으면 PC에서 할 일:
   - 스크립트가 출력한 `scp` 명령을 코드 블록으로 그대로 (PowerShell에서 실행, 서버 root 비밀번호 입력)
   - `chrome://extensions` → 통학 알리미 카드 ↻ → 카드의 버전이 새 버전인지 확인
   - 바뀐 파일에 `sample-profile.json`이 있으면: 팝업 "코드 변경 → 예시 데이터로 보기" 다시 누르기
   - 바뀐 파일에 `background.js` · `manifest.json`이 있으면: 알림 예약이 다시 잡혔는지 팝업 "다음 알림" 확인
