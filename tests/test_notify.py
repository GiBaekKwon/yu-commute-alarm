import copy, json, os, subprocess, sys, threading, shutil
from http.server import BaseHTTPRequestHandler, HTTPServer
HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "..", "server")
SAMPLE = os.path.join(HERE, "..", "site", "data", "sample-timetable.json")
import tempfile
WORK = tempfile.mkdtemp(prefix="wakeup-notify-test-")
DATA, STATE = os.path.join(WORK, "profiles"), os.path.join(WORK, "sent.json")
shutil.rmtree(WORK, ignore_errors=True); os.makedirs(DATA)
got, mode = [], {"fail": False}
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if mode["fail"]: self.send_response(500); self.end_headers(); return
        got.append(body); self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
    def log_message(self, *a): pass
srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
env = dict(os.environ, WAKEUP_DATA_DIR=DATA, WAKEUP_STATE=STATE, NTFY_URL=f"http://127.0.0.1:{srv.server_port}")
def run(*args):
    p = subprocess.run([sys.executable, os.path.join(SERVER, "notify.py"), *args], env=env, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr
def put(code, prof): json.dump(prof, open(os.path.join(DATA, code + ".json"), "w"), ensure_ascii=False)
sample = json.load(open(SAMPLE, encoding="utf-8"))
def prof(**notify):
    p = copy.deepcopy(sample); p["notify"].update({"enabled": True, "topic": "wakeup-test", "sendAt": "21:00"}); p["notify"].update(notify); return p
ok = bad = 0
def check(name, a, e):
    global ok, bad
    if a == e: ok += 1; print("PASS", name)
    else: bad += 1; print("FAIL", name, "\n     기대", e, "\n     실제", a)

put("aaaa1111", prof())
put("bbbb2222", prof(enabled=False))                       # 알림 꺼짐
open(os.path.join(DATA, "cccc3333.json"), "w").write("{깨짐")  # 깨진 파일
# 일요일(11/22) 밤 → 내일 월요일
run("--at", "2026-11-22T20:59"); check("20:59 → 아직 안 보냄", len(got), 0)
rc, out = run("--at", "2026-11-22T21:00")
check("21:00 → 1건 발송 (알림 켠 사람만, 깨진 파일 무시)", (rc, len(got)), (0, 1))
check("제목", got[0]["title"], "⏰ 내일(월) 07:20 기상")
check("본문", got[0]["message"], "08:00 출발 → 08:05 예시 노선 A (예시)\n첫 수업 09:00 자료구조 (공학관 302호)\n폰 알람을 이 시각에 맞춰 주세요.")
check("토픽 · 태그", (got[0]["topic"], got[0]["tags"]), ("wakeup-test", ["alarm_clock"]))
run("--at", "2026-11-22T21:01"); check("21:01 → 같은 날 중복 발송 없음", len(got), 1)
# 월요일 밤: 창(15분) 밖이면 안 보냄, 안이면 보냄
run("--at", "2026-11-23T21:15"); check("다음날 21:15 (창 밖) → 안 보냄", len(got), 1)
run("--at", "2026-11-23T21:14"); check("다음날 21:14 (cron 이 빠졌어도 창 안) → 발송", (len(got), got[-1]["title"]), (2, "⏰ 내일(화) 08:45 기상"))
# 금요일 밤 → 토요일 수업 없음
rc, out = run("--at", "2026-11-27T21:00"); check("금요일 밤 → 내일 수업 없어 안 보냄 + 기록", (len(got), "내일 수업 없음" in out, json.load(open(STATE)).get("aaaa1111")), (2, True, "2026-11-27"))
rc, out = run("--at", "2026-11-27T21:01"); check("수업 없는 날 로그도 한 번만", out.strip(), "")
# 발송 실패 → 기록 안 함 → 다음 실행에서 재시도
mode["fail"] = True
rc, out = run("--at", "2026-11-29T21:00"); check("ntfy 실패 → 기록 안 함", ("발송 실패" in out, json.load(open(STATE)).get("aaaa1111")), (True, "2026-11-27"))
mode["fail"] = False
run("--at", "2026-11-29T21:01"); check("다음 실행에서 재시도 성공", (len(got), got[-1]["title"]), (3, "⏰ 내일(월) 07:20 기상"))
# 첫차 지각 · 버스 없음 · 자정 넘김
late = prof(); late["commute"]["routeId"] = "route-c"; late["classes"] = [{"id": "a", "name": "1교시", "day": 1, "start": "08:00", "end": "09:00", "room": ""}]
put("dddd4444", late); rc, out = run("--now", "dddd4444", "--dry-run", "--at", "2026-11-22T21:00")
check("첫차 지각 경고", "⚠️ 첫차를 타도 약 13분 지각해요." in out, True)
nob = prof(); nob["commute"].update(routeId="", customTimes={"rideMin": 30, "weekday": [], "saturday": [], "sunday": []})
put("eeee5555", nob); rc, out = run("--now", "eeee5555", "--dry-run", "--at", "2026-11-22T21:00")
check("버스 없음 안내", "탈 버스가 없어요" in out, True)
night = prof(sendAt="23:50"); night["classes"] = [{"id": "a", "name": "새벽", "day": 1, "start": "01:00", "end": "02:00", "room": ""}]
night["commute"] = {"prepMin": 30, "walkToStopMin": 10, "walkToRoomMin": 5, "bufferMin": 0, "routeId": "", "customTimes": {"rideMin": 30, "weekday": ["00:20"], "saturday": [], "sunday": []}}
put("ffff6666", night); rc, out = run("--now", "ffff6666", "--dry-run", "--at", "2026-11-22T21:00")
check("자정 넘김: 오늘 밤 23:40 + 알림 시각보다 빠름 경고", ("오늘 밤 23:40 기상 (내일 월요일 수업)" in out, "알림 시각(23:50)보다 빨라요" in out), (True, True))
night["notify"]["sendAt"] = "21:00"; put("ffff6666", night); rc, out = run("--now", "ffff6666", "--dry-run", "--at", "2026-11-22T21:00")
check("자정 넘김인데 알림이 먼저면 경고 없음", "보다 빨라요" in out, False)
# 11/21 이동 시간 모드 (출발지 → 도착지 이동 시간 · 노선 파일 없음)
trv = prof(); trv["commute"] = {"prepMin": 40, "travelMin": 37, "bufferMin": 10}
put("gggg7777", trv); rc, out = run("--now", "gggg7777", "--dry-run", "--at", "2026-11-22T21:00")
check("이동 시간 모드: 내일(월) 07:33 기상 · 08:13 출발 (이동 37분 · 총 87분)", ("내일(월) 07:33 기상" in out, "08:13 출발 (이동 37분 · 총 87분)" in out, "버스" in out.split("제목:")[-1].split("폰 알람")[0]), (True, True, False))
# dry-run 은 보내지 않음
n = len(got); rc, out = run("--dry-run", "--at", "2026-11-22T21:00")
check("--dry-run: 보내지 않고 알림 켠 프로필 문구만", (len(got) == n, out.count("제목:"), "bbbb2222" in out), (True, 5, False))
# --now 는 시각과 상관없이 즉시
rc, out = run("--now", "aaaa1111", "--at", "2026-11-22T10:00"); check("--now: 즉시 발송", (rc, len(got), "발송 완료" in out), (0, n + 1, True))
rc, out = run("--now", "zzzz9999"); check("--now 없는 코드", (rc, "없습니다" in out), (1, True))
rc, out = run("--now", "BAD"); check("--now 잘못된 코드", rc, 2)
# 지운 프로필 기록 정리
os.unlink(os.path.join(DATA, "aaaa1111.json")); run("--at", "2026-11-30T03:00")
check("지운 프로필 기록 정리", "aaaa1111" in json.load(open(STATE)), False)
rc, out = run("--dry-run", "--at", "2026-11-30T03:00"); check("깨진 파일은 --dry-run 에서 알려 줌", "cccc3333] 프로필을 읽을 수 없음" in out, True)
print(f"==> {ok} / {ok+bad} PASS", "✅" if not bad else "❌"); sys.exit(1 if bad else 0)
