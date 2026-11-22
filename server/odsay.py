"""ODsay 대중교통 길찾기 → 통학 경로 후보 (등록할 때 한 번만 호출)

확인 근거: docs/odsay-route-test.md (2026-11-21)
  - GET https://api.odsay.com/v1/api/searchPubTransPathT  (apiKey, SX, SY, EX, EY)
    SX · EX = 경도(128.xxx), SY · EY = 위도(35.xxx)
  - result.path[].info.totalTime            총 소요 시간(분)
  - result.path[].subPath[].trafficType     1 지하철, 2 버스, 3 도보
                          .sectionTime     구간 소요 시간(분)
                          .lane[].name / .busNo   지하철 노선 이름 / 버스 번호
                          .startName · .startLocalStationID   승차 역 · 정류장 이름 / TAGO 정류장 ID
  - info.totalWalkTime 은 -1 로 와서 쓰지 않는다 → 도보 = trafficType 3 구간 sectionTime 합.
  - 오류 응답 형태는 문서에 없다 → result.path 가 빈 배열이면 no_route, 그 밖은 모두 upstream.

키: 환경 변수 ODSAY_KEY (systemd EnvironmentFile=/root/wakeup/.env) 에서만 읽는다.
    키가 들어간 요청 URL 은 지역 변수로만 쓰고, 출력 · 로그 · 예외 메시지에 넣지 않는다.
    urllib 예외는 문자열로 바꾸지 않고 reason 코드로만 바꾼다 (raise ... from None).
    응답은 허용한 필드만 새 dict 로 옮긴다 → ODsay 응답 내용이 그대로 사용자에게 가지 않는다.
좌표: server/stops.json (팀 관리, 공개 정류장 좌표) 에만 있다. 사용자 프로필 · 응답에는 넣지 않는다.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

API_URL = "https://api.odsay.com/v1/api/searchPubTransPathT"
TIMEOUT = 8                    # 초
MAX_RESPONSE = 1024 * 1024     # 응답 최대 크기
MAX_CANDIDATES = 5             # 후보 최대 개수
MAX_LINES = 6                  # 후보 하나의 노선 이름 최대 개수
MAX_TEXT = 40                  # app.py 와 같은 글자 수 한도
MAX_MIN = 24 * 60
STOPS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stops.json")

STOP_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
WALK, SUBWAY, BUS = 3, 1, 2


class RouteError(Exception):
    """경로 조회 실패. reason 은 화면 안내용 코드"""

    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason
        self.message = message


MESSAGES = {
    "invalid_stop": "출발 · 도착 정류장을 목록에서 골라 주세요.",
    "no_key": "실제 경로 검색이 아직 준비되지 않았어요. 예시 노선으로 계산해요.",
    "no_route": "두 정류장 사이 대중교통 경로를 찾지 못했어요. 예시 노선으로 계산해요.",
    "upstream": "경로 정보를 받지 못했어요. 예시 노선으로 계산해요. 잠시 뒤 다시 시도할 수 있어요.",
}


def fail(reason):
    raise RouteError(reason, MESSAGES[reason])


# ---------------------------------------------------------------- 정류장 목록
def load_stops(path=STOPS_FILE):
    """stops.json → {id: stop}. 형식이 틀린 항목은 넣지 않는다."""
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    stops = {}
    for s in raw if isinstance(raw, list) else []:
        if not isinstance(s, dict):
            continue
        sid, x, y = s.get("id"), s.get("x"), s.get("y")
        if not isinstance(sid, str) or not STOP_ID_RE.match(sid):
            continue
        if s.get("role") not in ("from", "to") or s.get("kind") not in ("bus", "subway"):
            continue
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (x, y)):
            continue
        stops[sid] = s
    return stops


def public_stops(stops):
    """화면용 목록 — 좌표 · 출처는 빼고 id · 이름 · 종류 · 역할만"""
    return [{"id": s["id"], "name": _text(s.get("name")), "kind": s["kind"], "role": s["role"]}
            for s in stops.values()]


# ---------------------------------------------------------------- 응답 변환
def _int(v):
    if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= MAX_MIN:
        return v
    return None


def _text(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    if not isinstance(v, str):
        return ""
    return v.strip()[:MAX_TEXT]


def parse_path(p):
    """path 하나 → 후보 dict. 쓸 수 없는 경로면 None"""
    if not isinstance(p, dict) or not isinstance(p.get("info"), dict):
        return None
    total = _int(p["info"].get("totalTime"))
    subs = p.get("subPath")
    if total is None or not isinstance(subs, list) or not subs:
        return None

    walk, lines, board, rides = 0, [], None, 0
    for s in subs:
        if not isinstance(s, dict):
            return None
        kind, sec = s.get("trafficType"), _int(s.get("sectionTime"))
        if sec is None or kind not in (WALK, SUBWAY, BUS):
            return None
        if kind == WALK:
            walk += sec
            continue
        rides += 1
        lanes = s.get("lane") if isinstance(s.get("lane"), list) else []
        for lane in lanes:
            if not isinstance(lane, dict):
                continue
            name = _text(lane.get("busNo") if kind == BUS else lane.get("name"))
            if name and name not in lines and len(lines) < MAX_LINES:
                lines.append(name)
        if board is None:
            sid = _text(s.get("startLocalStationID"))
            board = {"id": sid if STOP_ID_RE.match(sid) else "", "name": _text(s.get("startName"))}

    if board is None or walk > total:     # 도보만 있는 경로 · 앞뒤가 안 맞는 값은 버림
        return None
    return {"totalMin": total, "walkMin": walk, "lines": lines, "transfers": rides - 1,
            "boardStopId": board["id"], "boardStopName": board["name"]}


def parse_response(data):
    """ODsay JSON → 후보 목록 (최대 MAX_CANDIDATES). 실패하면 RouteError"""
    result = data.get("result") if isinstance(data, dict) else None
    paths = result.get("path") if isinstance(result, dict) else None
    if not isinstance(paths, list):
        fail("upstream")
    candidates = []
    for p in paths:
        c = parse_path(p)
        if c:
            candidates.append(c)
        if len(candidates) >= MAX_CANDIDATES:
            break
    if not candidates:
        fail("no_route")
    return candidates


# ---------------------------------------------------------------- 호출
def _fetch(params, api_url=API_URL):
    """키를 붙여 ODsay 를 1회 호출 → JSON dict. 어떤 실패든 upstream (키 · URL 은 메시지에 없음)"""
    key = os.environ.get("ODSAY_KEY", "").strip()
    if not key:
        fail("no_key")
    url = api_url + "?" + urllib.parse.urlencode({"apiKey": key, **params})
    req = urllib.request.Request(url, headers={"User-Agent": "wakeup-commute/1.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(MAX_RESPONSE + 1)
    except Exception:                  # HTTPError · URLError · 시간 초과 등 — 원래 예외는 버린다
        raw = None
    finally:
        del url, req, key
    if raw is None or len(raw) > MAX_RESPONSE:
        fail("upstream")
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        data = None                    # 원래 예외(응답 내용 포함)는 버린다
    if data is None:
        fail("upstream")
    return data


def search_route(from_stop, to_stop, fetch=_fetch):
    """정류장 2개(stops.json 항목) → 후보 목록. fetch 는 테스트에서 바꿔 끼운다."""
    params = {"SX": from_stop["x"], "SY": from_stop["y"], "EX": to_stop["x"], "EY": to_stop["y"]}
    return parse_response(fetch(params))


# ---------------------------------------------------------------- 이름으로 이동 시간 (대시보드 통학 계산, 11/21)
# 화면(site/js/storage.js commuteRoute)이 보내는 출발지 · 도착지 이름 → 역 · 정류장 좌표 → 가장 빠른 경로의 분.
#   GET https://api.odsay.com/v1/api/searchStation (apiKey, stationName)
#   → result.station[].stationName · stationClass(1 버스, 2 지하철) · x(경도) · y(위도)  — 2026-11-21 이 서버에서 확인
# 좌표는 이 함수 안에서만 쓰고 응답 · 프로필 · 로그에 넣지 않는다 (CLAUDE.md 규칙 2).
STATION_URL = "https://api.odsay.com/v1/api/searchStation"
AREA = (128.30, 35.60, 129.10, 36.20)    # 대구 · 경산 일대 (경도 최소, 위도 최소, 경도 최대, 위도 최대) — 다른 지역 같은 이름 제외
CACHE_MAX = 500
_place_cache = {}                       # 검색어 → {name, x, y} (공개 역 · 정류장 좌표, 서버 메모리에만)

ROUTE_MESSAGES = {
    "invalid": "출발지 · 도착지를 1~40자로 입력해 주세요.",
    "not_found": "대구 · 경산에서 '{name}' 역 · 정류장을 찾지 못했어요. 역 · 정류장 이름으로 다시 입력해 보세요.",
    "no_route": "두 곳 사이 대중교통 경로를 찾지 못했어요. 너무 가까우면 걸어서 가는 시간을 넣어 주세요.",
}


def _in_area(x, y):
    return AREA[0] <= x <= AREA[2] and AREA[1] <= y <= AREA[3]


def resolve_place(name, fetch=_fetch):
    """이름 → {name, x, y}. 대구 · 경산 범위에서 이름이 같은 지하철역 > 같은 이름 > 첫 결과 순으로 고른다."""
    q = _text(name)
    if len(q) > 1 and q.endswith("역"):
        q = q[:-1]                      # "반월당역" → "반월당" (ODsay 지하철역 이름에는 '역'이 없다)
    if not q:
        raise RouteError("invalid", ROUTE_MESSAGES["invalid"])
    if q in _place_cache:
        return _place_cache[q]
    data = fetch({"stationName": q}, STATION_URL)
    result = data.get("result") if isinstance(data, dict) else None
    found = result.get("station") if isinstance(result, dict) else None
    if not isinstance(found, list):
        fail("upstream")
    cands = []
    for s in found:
        if not isinstance(s, dict):
            continue
        x, y = s.get("x"), s.get("y")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (x, y)) or not _in_area(x, y):
            continue
        sname = _text(s.get("stationName"))
        rank = (0 if sname == q and s.get("stationClass") == 2 else 1 if sname == q else 2)
        cands.append((rank, len(cands), {"name": sname or q, "x": x, "y": y}))
    if not cands:
        raise RouteError("not_found", ROUTE_MESSAGES["not_found"].format(name=_text(name)))
    place = min(cands)[2]
    if len(_place_cache) >= CACHE_MAX:
        _place_cache.clear()
    _place_cache[q] = place
    return place


def route_minutes(from_name, to_name, fetch=_fetch):
    """출발지 · 도착지 이름 → {minutes, summary, transfers, source} (가장 빠른 후보). 실패하면 RouteError"""
    a = resolve_place(from_name, fetch)
    b = resolve_place(to_name, fetch)
    if (a["x"], a["y"]) == (b["x"], b["y"]):
        raise RouteError("no_route", ROUTE_MESSAGES["no_route"])
    try:
        cands = parse_response(fetch({"SX": a["x"], "SY": a["y"], "EX": b["x"], "EY": b["y"]}))
    except RouteError as e:
        if e.reason == "no_route":
            raise RouteError("no_route", ROUTE_MESSAGES["no_route"]) from None
        raise
    best = min(cands, key=lambda c: c["totalMin"])
    via = " → ".join(best["lines"])
    summary = f"{a['name']} → {b['name']}" + (f" · {via}" if via else "") + f" · 도보 {best['walkMin']}분 포함"
    return {"minutes": best["totalMin"], "summary": summary[:120],
            "transfers": max(best["transfers"], 0), "source": "ODsay 길찾기"}
