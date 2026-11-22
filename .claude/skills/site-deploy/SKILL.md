---
name: site-deploy
description: 대시보드(site/) 배포 — deploy.sh 가 안 하는 두 검사(외부 주소 · 확장 zip 최신)를 먼저 하고, 배포는 반드시 sh deploy.sh 로 한다. site/ 를 고친 뒤 서버에 올릴 때, 또는 확장(extension/)을 고쳐 대시보드 "확장 받기" zip을 갱신할 때 사용.
---

# site-deploy — 사전 점검 + deploy.sh 배포

배포는 **`sh deploy.sh`로만** 한다 (CLAUDE.md "배포", 손으로 cp 금지 — 잠금 · 배포본 지문 · `?v=` · 전체 테스트 · 백업 · 기록을 deploy.sh가 함).
이 스킬은 그 앞에 deploy.sh가 보지 않는 것을 검사한다.

## 실행 (프로젝트 루트 `/root/wakeup`)
1. 사전 점검: `python3 .claude/skills/site-deploy/precheck.py`
   - 인자에 `zip`이 있거나 "확장 zip 최신"이 FAIL이면 `--zip`을 붙여 다시 실행 (extension/ 기준으로 zip 재생성)
   - "외부 주소" FAIL이면 배포하지 않고 원인을 보여 준다
2. 배포 미리 보기: `sh deploy.sh --check` → 검사 결과와 **바뀌는 파일 목록**을 사용자에게 보여 준다
   - 내가 고치지 않은 파일이 목록에 있으면 (팀원 작업 중일 수 있음) 그 사실을 알리고 배포해도 되는지 묻는다
3. 사용자가 배포를 원하면: `sh deploy.sh --yes` (확인 질문만 건너뜀, 검사 · 테스트는 그대로)
   - `--force`는 사용자가 팀 확인 후 명시적으로 요청할 때만
4. 스크립트 결과를 믿는다 — 같은 검사를 손으로 다시 하지 않는다

## 사전 점검 항목 (precheck.py)
| 항목 | 실패 뜻 | 고치는 법 |
|---|---|---|
| 외부 주소 | site/에 허용 밖 호스트(CDN 등) — CLAUDE.md 규칙 1 | 제거. 꼭 필요하면 사람 승인 후 `precheck.py` `ALLOWED_HOSTS`에 이유와 함께 추가 |
| 확장 zip 최신 | `site/download/wakeup-extension.zip`이 `extension/`과 다름 → 대시보드에서 예전 확장이 받아짐 | `--zip` 후 deploy.sh |

## deploy.sh가 멈출 때 (CLAUDE.md)
| 메시지 | 할 일 |
|---|---|
| 다른 사람이 배포 중 | 기다렸다가 다시 |
| 배포본이 밖에서 바뀜 (지문) | 팀에 확인 → 사용자가 원하면 `--force` |
| `?v=` 안 올림 | `site/*.html`의 `?v=`를 새 값으로 (내가 고친 js · css일 때만. 팀원 파일이면 팀원에게 알림) |
| 테스트 실패 · 테스트 중 site/ 바뀜 | 실패 원인을 보여 주고, 누가 고치는 중이면 끝난 뒤 다시 |

## 보고 형식 (한국어, 짧게)
1. 결과 한 줄: 배포 완료 / 사전 점검 실패 / deploy.sh 멈춤(이유)
2. 사전 점검 PASS · FAIL
3. 바뀌는(바뀐) 파일 목록 — 내가 고치지 않은 파일은 표시
4. 배포했으면: 백업 이름 · 접속 확인 · 백업 폴더 개수 → 정리할지 질문
5. zip을 다시 만들었으면: 대시보드 "확장 받기"로 받는 버전
