# ODsay 길찾기 연동 — 인계 메모 (2026-11-21)

> 근거 문서: `docs/odsay-route-test.md` · 계획 원본: `/root/.claude/plans/pasted-content-id-9156-docs-odsay-route-smooth-heron.md`
> 키 값은 이 문서에 적지 않는다. 서비스는 **재시작하지 않았다**.


> **11/21 16:45 업데이트 — 연결 완료.** 2장 2 · 3 · 5번 처리: `POST /api/commute/route`(이름 → `searchStation` → 가장 빠른 경로, 화면이 기대하던 `{ok, minutes, summary, transfers, source}` 형식), systemd `EnvironmentFile` 추가 · 재시작(백업 `wakeup-api.service.bak-20261121-1643`), `tests/test_route.py`. 프로필 형식은 바꾸지 않음(`commute.odsay` 필드 추가 안 함). 자세한 내용은 `plan.md` A-1-2.
> 확인된 사실: 지하철 구간에는 `startLocalStationID` 가 오지 않는다(빈 값). 4번(정류장 목록 선택 화면)은 하지 않음 — 지금 화면의 이름 입력으로 동작.

## 1. 만든 파일 (서버에 연결 전, 아직 아무 곳에서도 import 안 함)
| 파일 | 내용 |
|---|---|
| `server/stops.json` | 정류장 4개 (source "TAGO 조회 2026-11-21"). from: 2호선반월당역1 `DGB7001001400`, 2호선반월당역2 `DGB7001012300` / to: 영남대 앞 `GYB360005700`, 영남대서문 `GYB360052345`. 좌표는 이 파일에만 있음 |
| `server/odsay.py` | `searchPubTransPathT` 호출 · 변환 모듈 (`everytime.py`와 같은 형태) |

`odsay.py` 요약
- `load_stops()` → `{id: stop}`, `public_stops()` → 좌표 뺀 `[{id, name, kind, role}]`
- `search_route(from_stop, to_stop, fetch=_fetch)` → 후보 최대 5개
  `{totalMin, walkMin, lines, boardStopId, boardStopName}`
  - `walkMin` = `trafficType 3` 구간 `sectionTime` 합 (`info.totalWalkTime`은 -1이라 안 씀)
  - `boardStopId` = 첫 버스 · 지하철 구간의 `startLocalStationID` (없으면 `""`)
- 실패하면 `RouteError(reason)`: `invalid_stop` · `no_key` · `no_route` · `upstream` (`MESSAGES`에 화면 문구)
- 키: `os.environ["ODSAY_KEY"]`에서만 읽는다. 요청 URL은 지역 변수로만 쓰고, urllib 예외는 버린 뒤 reason으로만 바꾼다(예외 체인 없음). 응답은 허용한 필드만 옮긴다.
- 확인한 것: 정류장 로드, 좌표 제외, 키 없을 때 `no_key`. **실제 ODsay 호출은 아직 안 함.**

## 2. 남은 작업
1. **계산 반영 방식 결정 (먼저)** — 16:23~27에 이동 시간 모드(`commute = {prepMin, travelMin, bufferMin}`, `calc.js` · `app.py` `TRAVEL_KEYS`)가 추가됨. 원래 계획은 "예시 노선의 `rideMin`만 ODsay 총 시간으로 교체"였으나, 이제는 **고른 후보 `totalMin` → `travelMin`** 이 더 자연스러워 보임. 팀에서 정할 것.
   - 프로필에 선택 필드 `commute.odsay = {fromStopId, toStopId, fetchedAt, chosen}` 추가 시 `app.py` 검사 · `storage.js` 정규화 · `plan.md` 2-1 함께 수정. 좌표 필드는 허용하지 않음.
2. **`app.py` 연결** — `GET /api/commute/stops`, `POST /api/commute/route` (본문 `{"from","to"}` = stops.json id, role 확인). `too_many()`에 버킷 인자를 추가해 에타와 따로 횟수 제한(예: 1분 5회). 상태 코드: invalid_stop 400 · no_route 422 · no_key 503 · upstream 502 · rate_limited 429.
3. **서비스 `.env` 연결** — `server/wakeup-api.service`의 `Environment=` 줄 아래에 `EnvironmentFile=/root/wakeup/.env` 추가 후:
   ```bash
   sudo cp -a /etc/systemd/system/wakeup-api.service /etc/systemd/system/wakeup-api.service.bak-$(date +%Y%m%d-%H%M)
   sudo cp /root/wakeup/server/wakeup-api.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl restart wakeup-api
   systemctl status wakeup-api --no-pager; curl -s http://127.0.0.1:5100/api/health
   ```
   코드만 바뀌면 `sudo systemctl restart wakeup-api`만. Nginx 수정 불필요. `.env`(600) 내용을 화면에 출력하지 않는다.
   ODsay 서버 키에 이 서버 공인 IP가 등록돼 있어야 함 (`odsay-route-test.md` 2장).
4. **화면 연결** — 등록 화면에서 출발 · 도착 정류장 선택 → [실제 경로 찾기] 버튼을 눌렀을 때만 1회 호출 → 후보 선택 → 저장할 때 프로필에 반영. 대시보드는 호출하지 않음. 실패하면 예시 노선 + "예시" 표시. JS · CSS 수정 시 `?v=` 갱신, 360 · 400px 확인.
5. **테스트** — `tests/test_odsay.py`(합성 fixture로 변환 확인, 가짜 키 `TESTKEY_DO_NOT_LEAK`가 응답 · 예외 · 로그에 없는지, `--live` 1회 확인), `tests/test_api.py`(odsay 있는 · 없는 프로필), `run-all.sh`에 추가, `site/test.html` 전 항목 PASS.
   - `odsay-route-test.md`에 원본 JSON이 없어서 fixture는 4장 1번 경로(도보 4 + 2호선 27 + 도보 2 = 33분)를 문서의 필드 이름으로 만든 **합성** 데이터로 둔다.
6. **문서** — `plan.md` 2-4(API 입출력 · 실패 표), `CLAUDE.md` 폴더 구조에 `odsay.py · stops.json` 추가.

## 3. `plan.md` 8장에 올릴 질문
- 반월당 외 출발 정류장 · 역 후보 (TAGO 조회값)
- 영남대 쪽 "건너" · "서문 건너" · "동문 차고지"가 등교 방향 도착지로 맞는지
- ODsay 오류 응답 형태, 하루 호출 한도, 지하철 구간에도 `startLocalStationID`가 오는지
