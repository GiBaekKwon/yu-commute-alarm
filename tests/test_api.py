import copy, json, os, sys, glob, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "server"))
os.environ["WAKEUP_DATA_DIR"] = tempfile.mkdtemp(prefix="wakeup-api-test-")
import app as A
A.ensure_store()
for f in glob.glob(os.path.join(A.DATA_DIR, "*")): os.unlink(f)
c = A.app.test_client()
sample = json.load(open(os.path.join(HERE, "..", "site", "data", "sample-timetable.json"), encoding="utf-8"))
ok = bad = 0
def check(name, actual, expected):
    global ok, bad
    if actual == expected: ok += 1; print("PASS", name)
    else: bad += 1; print("FAIL", name, "\n     기대", expected, "\n     실제", actual)
def put(code, body, raw=None):
    if raw is not None: return c.put(f"/api/profile/{code}", data=raw, content_type="application/json")
    return c.put(f"/api/profile/{code}", json=body)

check("health", (c.get("/api/health").status_code, c.get("/api/health").json), (200, {"ok": True}))
check("없는 코드 GET → 404", c.get("/api/profile/abcd1234").status_code, 404)
r = put("test1234", sample)
check("예시 PUT → 200", (r.status_code, r.json), (200, {"ok": True, "code": "test1234"}))
check("GET 이 같은 내용", c.get("/api/profile/test1234").json, sample)
check("GET 캐시 금지", c.get("/api/profile/test1234").headers.get("Cache-Control"), "no-store")
check("파일 권한 640", oct(os.stat(os.path.join(A.DATA_DIR, "test1234.json")).st_mode & 0o777), "0o640")
for code in ["TEST1234", "test123", "test12345", "../etc/p", "test_123"]:
    check(f"잘못된 코드 {code!r} → 400/404", c.get(f"/api/profile/{code}").status_code in (400, 404) and put(code, sample).status_code in (400, 404, 405), True)
def mutated(fn):
    p = copy.deepcopy(sample); fn(p); return put("test1234", p)
cases = {
  "주소 필드": lambda p: p.__setitem__("address", "경산시"),
  "수업에 전화번호": lambda p: p["classes"][0].__setitem__("phone", "010"),
  "통학에 좌표": lambda p: p["commute"].__setitem__("homeLat", 35.8),
  "필드 누락": lambda p: p["commute"].pop("bufferMin"),
  "시각 24:00": lambda p: p["classes"][0].__setitem__("end", "24:00"),
  "시작 ≥ 종료": lambda p: p["classes"][0].__setitem__("end", "08:00"),
  "음수 분": lambda p: p["commute"].__setitem__("prepMin", -1),
  "문자열 분": lambda p: p["commute"].__setitem__("prepMin", "40"),
  "소수 분": lambda p: p["commute"].__setitem__("prepMin", 2.5),
  "true 를 분으로": lambda p: p["commute"].__setitem__("prepMin", True),
  "요일 7": lambda p: p["classes"][0].__setitem__("day", 7),
  "긴 과목명": lambda p: p["classes"][0].__setitem__("name", "가" * 41),
  "version 2": lambda p: p.__setitem__("version", 2),
  "노선 없음": lambda p: p["commute"].__setitem__("routeId", ""),
  "직접입력 역순": lambda p: (p["commute"].__setitem__("routeId", ""), p["commute"].__setitem__("customTimes", {"rideMin": 30, "weekday": ["08:00", "07:00"], "saturday": [], "sunday": []})),
  "알림 켰는데 토픽 없음": lambda p: p["notify"].__setitem__("enabled", True),
}
for name, fn in cases.items():
    r = mutated(fn)
    check(f"거부: {name} → 400", (r.status_code, "error" in r.json), (400, True))
check("거부돼도 기존 저장본 그대로", c.get("/api/profile/test1234").json, sample)
p = copy.deepcopy(sample); p["commute"]["routeId"] = ""; p["commute"]["customTimes"] = {"rideMin": 30, "weekday": ["07:25", "08:05"], "saturday": [], "sunday": []}
check("직접 입력 프로필 저장 → 200", put("abcd1234", p).status_code, 200)
# 11/21 이동 시간 모드: {prepMin, travelMin, bufferMin} 만 허용 (출발지 · 도착지 · 좌표는 거부)
trv = copy.deepcopy(sample); trv["commute"] = {"prepMin": 40, "travelMin": 37, "bufferMin": 10}
check("이동 시간 모드 저장 → 200 · 같은 내용", (put("trvl1234", trv).status_code, c.get("/api/profile/trvl1234").json["commute"]), (200, {"prepMin": 40, "travelMin": 37, "bufferMin": 10}))
for name, extra in {"출발지 이름": {"from": "반월당"}, "좌표": {"homeLat": 35.8}, "노선 섞기": {"routeId": "route-a"}}.items():
    t = copy.deepcopy(trv); t["commute"].update(extra)
    check(f"거부: 이동 시간 모드에 {name} → 400", put("trvl1234", t).status_code, 400)
for name, v in {"이동 0분": 0, "이동 문자열": "37", "이동 소수": 2.5}.items():
    t = copy.deepcopy(trv); t["commute"]["travelMin"] = v
    check(f"거부: {name} → 400", put("trvl1234", t).status_code, 400)
check("JSON 아님 → 400", put("test1234", None, raw="not json").status_code, 400)
check("배열 본문 → 400", put("test1234", [1, 2]).status_code, 400)
big = copy.deepcopy(sample); big["pad"] = "x" * 21000
check("20KB 초과 → 413", put("test1234", big).status_code, 413)
check("없는 주소 → 404 JSON", (c.get("/api/nope").status_code, "error" in c.get("/api/nope").json), (404, True))
check("DELETE 불가 → 405", c.delete("/api/profile/test1234").status_code, 405)
A.MAX_PROFILES = 2
check("최대 개수 초과 새 코드 → 507", put("zzzz9999", sample).status_code, 507)
check("최대 개수여도 기존 코드 수정은 됨", put("test1234", sample).status_code, 200)
check("임시 파일 남지 않음", [f for f in os.listdir(A.DATA_DIR) if f.startswith(".")], [])
print(f"==> {ok} / {ok+bad} PASS", "✅" if not bad else "❌")
sys.exit(1 if bad else 0)
