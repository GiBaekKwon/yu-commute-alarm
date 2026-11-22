# 통학 길찾기 API (POST /api/commute/route) — 합성 ODsay 응답으로 검사 (실제 ODsay 는 부르지 않음)
#   python3 tests/test_route.py
#   python3 tests/test_route.py --live     이 서버의 .env 키로 반월당역 → 영남대 1회 실제 호출 (ODsay 한도 3회 사용)
import json, os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "server"))
os.environ["WAKEUP_DATA_DIR"] = tempfile.mkdtemp(prefix="wakeup-route-test-")
import app as A
import odsay as O

ok = bad = 0
def check(name, actual, expected):
    global ok, bad
    if actual == expected: ok += 1; print("PASS", name)
    else: bad += 1; print("FAIL", name, "\n     기대", expected, "\n     실제", actual)

if "--live" in sys.argv:
    try:
        r = O.route_minutes("반월당역", "영남대")
        print("LIVE OK", json.dumps(r, ensure_ascii=False))
        sys.exit(0)
    except O.RouteError as e:
        print("LIVE FAIL", e.reason, e.message); sys.exit(1)

FAKE_KEY = "TESTKEY_DO_NOT_LEAK"
STATIONS = {
    "반월당": [{"stationName": "반월당역(1번출구)1", "stationClass": 1, "x": 128.593, "y": 35.863},
              {"stationName": "반월당", "stationClass": 2, "x": 128.5933, "y": 35.8645}],
    "영남대": [{"stationName": "영남대", "stationClass": 2, "x": 128.7529, "y": 35.8363}],
    "서울역": [{"stationName": "서울역", "stationClass": 2, "x": 126.97, "y": 37.55}],   # 대구 · 경산 범위 밖
}
# docs/odsay-route-test.md 4장 1번 경로(도보 4 + 2호선 27 + 도보 2 = 33분)와 같은 필드 이름의 합성 데이터
PATHS = [
    {"info": {"totalTime": 45}, "subPath": [{"trafficType": 3, "sectionTime": 3},
        {"trafficType": 2, "sectionTime": 40, "lane": [{"busNo": "649"}], "startName": "반월당", "startLocalStationID": "DGB1"},
        {"trafficType": 3, "sectionTime": 2}]},
    {"info": {"totalTime": 33}, "subPath": [{"trafficType": 3, "sectionTime": 4},
        {"trafficType": 1, "sectionTime": 27, "lane": [{"name": "대구 2호선"}], "startName": "반월당"},
        {"trafficType": 3, "sectionTime": 2}]},
]
calls = []
mode = {"route": "ok"}
def fake(params, api_url=O.API_URL):
    calls.append(api_url)
    url = api_url + "?" + "apiKey=" + FAKE_KEY            # 진짜 _fetch 처럼 키가 붙은 URL 을 만들지만 밖으로 내보내지 않는다
    del url
    if api_url == O.STATION_URL:
        return {"result": {"station": STATIONS.get(params["stationName"], [])}}
    if mode["route"] == "ok": return {"result": {"path": PATHS}}
    if mode["route"] == "empty": return {"result": {"path": []}}
    if mode["route"] == "error": return {"error": [{"code": "500", "message": "x"}]}
    if mode["route"] == "nokey": O.fail("no_key")
O.route_minutes.__defaults__ = (fake,)

c = A.app.test_client()
def post(body, ip="10.0.0.1"):
    return c.post("/api/commute/route", json=body, headers={"X-Real-IP": ip})

r = post({"from": "반월당역", "to": "영남대"})
check("정상 → 200", r.status_code, 200)
check("가장 빠른 후보(33분) · 환승 0", (r.json.get("ok"), r.json.get("minutes"), r.json.get("transfers"), r.json.get("source")), (True, 33, 0, "ODsay 길찾기"))
check("요약 = 역 이름 · 노선 · 도보", r.json.get("summary"), "반월당 → 영남대 · 대구 2호선 · 도보 6분 포함")
check("응답 필드는 5개만 (좌표 없음)", sorted(r.json), ["minutes", "ok", "source", "summary", "transfers"])
check("캐시 금지", r.headers.get("Cache-Control"), "no-store")
check("응답에 키 없음", FAKE_KEY in r.get_data(as_text=True), False)
n = len(calls)
post({"from": "반월당", "to": "영남대"}, ip="10.0.0.2")
check("같은 장소는 정류장 검색을 다시 안 함 (경로 1회만)", calls[n:], [O.API_URL])

for name, body in {"from 없음": {"to": "영남대"}, "빈 문자열": {"from": " ", "to": "영남대"},
                   "41자": {"from": "가" * 41, "to": "영남대"}, "숫자": {"from": 1, "to": "영남대"}}.items():
    r = post(body, ip="10.0.1.1")
    check(f"거부: {name} → 400 invalid", (r.status_code, r.json.get("reason")), (400, "invalid"))
r = c.post("/api/commute/route", data="x", content_type="text/plain", headers={"X-Real-IP": "10.0.1.1"})
check("JSON 아님 → 400", r.status_code, 400)

r = post({"from": "서울역", "to": "영남대"}, ip="10.0.2.1")
check("대구 · 경산 밖 → 422 not_found", (r.status_code, r.json.get("reason")), (422, "not_found"))
check("못 찾은 이름을 안내에 표시", "서울역" in r.json.get("error", ""), True)
r = post({"from": "없는곳", "to": "영남대"}, ip="10.0.2.1")
check("검색 결과 없음 → 422 not_found", (r.status_code, r.json.get("reason")), (422, "not_found"))
r = post({"from": "영남대", "to": "영남대역"}, ip="10.0.2.1")
check("같은 곳 → 422 no_route", (r.status_code, r.json.get("reason")), (422, "no_route"))
mode["route"] = "empty"
r = post({"from": "반월당", "to": "영남대"}, ip="10.0.2.2")
check("경로 없음 → 422 no_route", (r.status_code, r.json.get("reason")), (422, "no_route"))
check("no_route 안내는 길찾기 화면 문구", "예시 노선" in r.json.get("error", ""), False)
mode["route"] = "error"
r = post({"from": "반월당", "to": "영남대"}, ip="10.0.2.2")
check("ODsay 오류 응답 → 502 upstream", (r.status_code, r.json.get("reason")), (502, "upstream"))
mode["route"] = "nokey"
r = post({"from": "반월당", "to": "영남대"}, ip="10.0.2.2")
check("키 없음 → 503 not_configured", (r.status_code, r.json.get("reason")), (503, "not_configured"))
mode["route"] = "ok"

codes = [post({"from": "반월당", "to": "영남대"}, ip="10.0.3.1").status_code for _ in range(A.ROUTE_LIMIT + 1)]
check(f"같은 IP 1분 {A.ROUTE_LIMIT}회 초과 → 429", codes[-1], 429)
check("다른 IP 는 계속 됨", post({"from": "반월당", "to": "영남대"}, ip="10.0.3.2").status_code, 200)
check("에타 가져오기 횟수와 따로 셈", A.too_many("10.0.3.1"), False)
A._daily.update(date=A.time.strftime("%Y-%m-%d"), count=A.ROUTE_DAILY)
r = post({"from": "반월당", "to": "영남대"}, ip="10.0.4.1")
check("하루 한도 초과 → 429 rate_limited", (r.status_code, r.json.get("reason")), (429, "rate_limited"))

# 실제 _fetch: 키가 없으면 no_key, 키를 넣어도 예외 · 메시지에 키가 없어야 함 (네트워크 안 씀: 잘못된 주소)
os.environ.pop("ODSAY_KEY", None)
try: O._fetch({}); check("실제 _fetch 키 없음 → no_key", "no error", "no_key")
except O.RouteError as e: check("실제 _fetch 키 없음 → no_key", e.reason, "no_key")
os.environ["ODSAY_KEY"] = FAKE_KEY
try: O._fetch({}, "http://127.0.0.1:9/none"); check("실제 _fetch 연결 실패 → upstream", "no error", "upstream")
except O.RouteError as e:
    check("실제 _fetch 연결 실패 → upstream", e.reason, "upstream")
    check("예외에 키 · 원래 예외 없음", (FAKE_KEY in repr(e) + str(e.args), e.__cause__, e.__suppress_context__ or e.__context__ is None), (False, None, True))

print(f"\n{ok} PASS, {bad} FAIL")
sys.exit(1 if bad else 0)
