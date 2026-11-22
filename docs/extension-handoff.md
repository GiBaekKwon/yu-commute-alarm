# 크롬 확장(extension/) 작업 인수인계

> 작성: 2026-11-21 (토). 다음 세션은 VSCode에서 `/root/wakeup` 폴더를 열고 시작한다.

## 1. 역할과 범위
- 개발자 2명: **대시보드(`site/` · `server/`) = 팀원**, **크롬 확장(`extension/`) = 나**.
- 확장 세션에서는 `extension/`만 수정한다. `site/` · `server/`는 건드리지 않는다.
- 확장 범위
  - 팝업: 다음 수업 카운트다운(1초) · 오늘 남은 수업 · 미니 시간표 ([오늘] · [주간] 탭)
  - 수업 5 · 10 · 15분 전 PC 알림 (기본 10분). **서버의 전날 밤 기상 알림(폰)과는 별개**
  - **넣지 않음**: 기상 시각 · 버스 · 도보 (노트북을 켜고 있으면 이미 이동 · 작업 중)
- 디자인은 대시보드가 완성되면 맞춘다 → 지금은 `popup.css` 맨 위 `:root` 변수만 정의된 임시 스타일.
- 같은 판단 로직(남은 수업 · 다음 수업)은 확장 `js/schedule.js`와 대시보드 `site/js/today.js`에 각자 있다. 나중에 하나로 합친다.

## 1-1. 대시보드 11/21 개편이 확장에 주는 영향 (CLAUDE.md · plan.md A장)
- 대시보드 메인이 바뀜: **에타 공개 공유 링크로 시간표 가져오기** → 다음 수업 · 오늘 남은 수업 · 주간 시간표 + **대시보드가 열려 있을 때 수업 10분 전 화면 배너**(시스템 알림 · 소리 없음). 통학 계획은 부가 기능으로 내려감.
- **프로필 형식은 그대로** (`version: 1`, `classes[{id,name,day,start,end,room}]`, 에타 가져오기 결과도 같은 형식) → 확장 수정 필요 없음.
- **역할 구분 (발표 포인트)**: 대시보드 배너 = 탭이 열려 있을 때 화면 안에서 / 확장 알림 = 탭이 없어도 크롬만 켜져 있으면 PC 시스템 알림. 둘 다 켜 두면 같은 수업에 배너와 PC 알림이 각각 한 번씩 올 수 있음(중복 기록이 서로 따로).
- **알림 규칙 (11/21 맞춤, v0.2.2)**: 대시보드 A-3과 같이, 알림 시각을 놓쳤어도 수업 시작 전이면 그 순간 남은 시간으로 바로 1회 PC 알림(예: 수업 7분 전에 크롬을 켬 → "7분 뒤 인공지능"). 이전(v0.2.1)에는 알림만 건너뛰고 다음 수업으로 예약했음(카운트다운은 원래부터 그 수업 표시).
  - `findNextReminder(profile, now, leadMin, notifiedKeys)` → `late: true`면 `background.js`가 즉시 알림. 이미 알린 수업은 `storage.notified`(최근 20개 key)로 건너뜀. 예약 · 알림 작업은 `run()`으로 한 줄 처리 → 이벤트가 겹쳐도 중복 없음.
- 합칠 로직 대상이 바뀜: `site/js/today.js` → **`site/js/classes.js`** (`nextClass` · `remainingToday` · `alertTarget`, 순수 함수).
- 대시보드 체험 모드: `http://101.79.26.150/wakeup/?demo=9` (9분 뒤 체험 수업 → 즉시 배너). 확장은 "테스트 알림 (1분 뒤)".

## 2. 현재 상태 (v0.2.1 — 11/21 `/ext-check` 전 항목 통과, PC 반영 완료)
| 파일 | 내용 |
|---|---|
| `manifest.json` | MV3, 권한 storage · alarms · notifications, `host_permissions: http://101.79.26.150/*` |
| `config.js` | `API_BASE = http://101.79.26.150/wakeup/api`, `WEB_BASE = http://101.79.26.150/wakeup/` |
| `js/schedule.js` | 순수 함수: getTodayStatus · findNextClassDay · findNextReminder · buildWeekGrid · validateProfile |
| `popup.html/css/js` | 탭, 코드 입력, "예시 데이터로 보기", 캐시 · 오프라인 표시, 알림 설정, 테스트 알림(1분 뒤), `?now=` 시각 지정 |
| `background.js` | 다음 수업 N분 전 `chrome.alarms` 예약 → 알림. 늦게 울림 · 중복 · 조기 울림 방지, 30분마다 재예약 + 서버 재동기화 |
| `sample-profile.json` | mock 데이터 (plan.md 2-1 형식). 시연용 **토 · 일 수업 포함** |
| `test/schedule.test.js` | `node extension/test/schedule.test.js` → 77개 PASS (늦게 켬 · 중복 알림 케이스 포함) |
| `.claude/skills/ext-check/` | `/ext-check` 스킬: 점검 → 버전 +1 → PC용 scp 명령 출력 (`no-bump` 인자 시 버전 유지) |

- 데이터 출처: 지금은 mock → 대시보드 API `GET /wakeup/api/profile/<8자리 코드>`(동작 확인, 없는 코드는 404)로 전환 완료. 형식이 같아 화면 코드는 그대로.
- 문서 반영: `plan.md` 4단계 · 5장 · 8장, `CLAUDE.md` "크롬 확장 프로그램" 섹션.

## 3. PC 반영 방법
```powershell
scp -P 2222 -r "root@101.79.26.150:/root/wakeup/extension/*" "$HOME\wakeup-ext\"
```
→ `chrome://extensions`에서 통학 알리미 ↻. (SSH 포트 2222, 계정 root)
- 예시 데이터가 바뀌었으면 팝업 "코드 변경 → 예시 데이터로 보기" 다시 누르기.
- 다른 시각으로 보기: `chrome-extension://<통학 알리미 ID>/popup.html?now=2026-11-23T09:30` (알림에는 영향 없음).
- 팝업 하단 "대시보드 ↗" → 대시보드 메인 (v0.2.3부터, 이전엔 "웹에서 수정" → 설정).

## 3-1. 사용자 배포 (대시보드에서 받기, 11/21~)
- 대시보드 "크롬 확장 연결" 카드 맨 위에 **"통학 알리미 확장 받기 (.zip)"** + 설치 4단계(압축 풀기 → `chrome://extensions` 개발자 모드 → 압축해제된 확장 로드 → 툴바 고정). 웹 스토어 미등록이라 원클릭 설치는 불가.
- 파일: `site/download/wakeup-extension.zip` (`extension/`에서 `test/` · 숨김 파일 제외, zip 안 최상위 폴더 `wakeup-ext/`) → 배포 시 `/wakeup/download/wakeup-extension.zip`.
- **확장을 고치면 zip도 다시 만들고 대시보드를 재배포**해야 한다 (안 하면 예전 버전이 받아짐). `/ext-check` 통과 후:
  ```bash
  cd /root/wakeup && python3 -c "
  import zipfile,os
  with zipfile.ZipFile('site/download/wakeup-extension.zip','w',zipfile.ZIP_DEFLATED) as z:
      for r,d,f in os.walk('extension'):
          d[:]=sorted(x for x in d if x!='test' and not x.startswith('.'))
          for n in sorted(f):
              if not n.startswith('.'): p=os.path.join(r,n); z.write(p,os.path.join('wakeup-ext',os.path.relpath(p,'extension')))"
  ```
  그다음 CLAUDE.md "배포" 절차(백업 → `cp -r site/.`)로 올린다. 현재 zip = v0.2.3.
- 이 카드는 `site/index.html`(팀원 파일)이다. 11/21 사용자 승인으로 HTML만 수정함(CSS · JS 변경 없음 → `?v=` 그대로).

## 4. 확인 상태
- ✅ (11/21) PC 크롬 반영: 카드 버전 0.2.1, **Windows 알림 수신**(테스트 알림 1분 뒤), 팝업 "다음 알림" 예약 시각 표시, 눈에 보이는 오류 없음
- ✅ (11/21) 대시보드에서 저장한 **동기화 코드로 실제 연결** (코드 입력 → 같은 시간표)
- ✅ (11/21) 서버에 닿지 않을 때 캐시로 표시 (PC 인터넷 끄고 팝업 → 설정한 시간표 그대로)
- ✅ (v0.2.2) 늦게 켰을 때 바로 알림 — 자동 테스트 77개 + background.js 모의 실행 8항목으로 확인 (PC 실제 확인은 안 함)
  - 동기화 코드는 대시보드 메인이 아니라 **하단 탭 "설정" → "4. 다른 기기와 함께 쓰기" → "동기화 코드 만들기"**. 저장된 시간표가 있으면 만들 때 서버에도 올라감. 코드가 생긴 뒤 대시보드 "시간표 저장"은 서버에도 자동 반영.
  - 서버에 이미 있는 코드 `test1234`(수업 6개)로 확장만 먼저 시험 가능.

## 5. 다음 할 일 (우선순위 순)
1. **PC 실제 확인**: ✅ 11/21 완료 (알림 수신 · 동기화 코드 연결). 이후 문제 있으면 `chrome://extensions` 카드의 "오류" · "서비스 워커" 콘솔 내용을 가져온다.
2. **발표 시연 준비 (11/22 일요일)**: 예시 데이터의 일요일 수업(09:30 · 12:00 · 14:30 · 17:00)으로 카운트다운, "테스트 알림 (1분 뒤)"로 알림 장면. 대시보드(에타 가져오기 → 저장 → 동기화 코드) → 확장 코드 연결 장면을 넣을지 팀과 결정. 발표 메시지: "대시보드는 열어 둘 때 배너, 확장은 탭 없이도 PC 알림".
2-1. ✅ **알림 규칙 맞추기 (11/21 완료, v0.2.2)**: 대시보드 A-3처럼 "알림 시각이 지났어도 수업 시작 전이면 그 순간 남은 시간으로 1회 알림"으로 변경. 수정 위치: `schedule.js` `findNextReminder` · `background.js` · 테스트 수정.
3. ✅ **아이콘 (11/21 완료, v0.2.4)**: 주황 버스 × 시계(#E3814D) 16 · 32 · 48 · 128px 교체 + manifest에 32px 추가. 같은 세트로 대시보드 favicon.ico · apple-touch-icon.png도 넣음 (원본 zip: final-bus-clock-orange.zip, 1024px 포함).
4. **배포 준비 (plan.md 4단계 4번)**: zip 만들기(`test/` 제외). 서버 배포 위치 · 설치 안내 링크는 대시보드 팀원과 협의.
5. **디자인 맞춤**: 대시보드 `site/css/style.css` 완성 후 `popup.css` 변수 값 교체.
6. **로직 합치기**: `extension/js/schedule.js` ↔ `site/js/classes.js`(`nextClass` · `remainingToday` · `alertTarget`)의 판단을 하나로 (팀원과 함께).
7. **시연 후 정리**: 예시 데이터의 토 · 일 수업은 시연용 — 유지할지 결정.

## 6. 주의
- 서버는 root 계정을 팀원과 같이 쓰는 것으로 보인다. `/root/.claude/projects/-root/memory/`에 "사용자는 발표만 맡음", "extension/은 만들지 않음" 메모리가 있는데, 팀원 세션에서 저장된 것으로 보이며 이 작업과 반대다. 지우거나 고치지 않았다 (`/root/wakeup`에서 열면 메모리가 따로 쌓인다).
- 확인되지 않은 값(IP · 포트 · 버스 시각 등)은 추측하지 않는다 (CLAUDE.md 규칙 5).
