"""영남대 통학 기상 알리미 — 프로필 저장 API (2단계)

실행:  python3 /root/wakeup/server/app.py
주소:  http://127.0.0.1:5100  (이 서버 안에서만 접속 가능, Nginx 의 /wakeup/api/ 가 여기로 전달)

API
  GET  /api/health                 상태 확인 → {"ok": true}
  GET  /api/profile/<code>         프로필 불러오기 (없으면 404)
  PUT  /api/profile/<code>         프로필 저장 (plan.md 2-1 형식, 전체 교체)
  POST /api/import/everytime       에타 공개 공유 링크 → 시간표 변환 결과 (저장하지 않음, plan.md A-2)
                                   본문 {"url": "https://everytime.kr/@..."} → {"ok", "year", "semester", "classes", "skipped", "warnings"}
                                   실패 → {"error", "reason"}  (invalid_url · not_found · private · empty · upstream · rate_limited)
  POST /api/commute/route          출발지 → 도착지 이동 시간 (ODsay 길찾기, 저장하지 않음, server/odsay.py)
                                   본문 {"from": "반월당역", "to": "영남대"} → {"ok", "minutes", "summary", "transfers", "source"}
                                   실패 → {"error", "reason"}  invalid 400 · not_found 422 · no_route 422 · rate_limited 429
                                                                 upstream 502 · not_configured 503 (키 없음)

code: 등록 화면에서 만든 동기화 코드, 영문 소문자 · 숫자 8자리 ([a-z0-9]{8})

입력 검사 (plan.md 2단계)
  - 본문 20KB 까지, JSON 객체만
  - 2-1 형식에 없는 필드는 거부(400) → 주소 · 이름 · 학번 같은 개인정보 유입 방지
  - 시각은 "HH:MM"(00:00~23:59), 길이는 0 이상의 정수(분)

데이터: /var/lib/wakeup-api/profiles/<code>.json  (WAKEUP_DATA_DIR 로 바꿀 수 있음)
저장은 임시 파일에 다 쓴 뒤 os.replace 로 한 번에 교체한다 (쓰는 도중 꺼져도 파일이 깨지지 않게).
"""

import json
import os
import re
import tempfile
import threading
import time
from collections import deque

from flask import Flask, jsonify, request

import everytime
import odsay

HOST = "127.0.0.1"
PORT = int(os.environ.get("WAKEUP_PORT", "5100"))
DATA_DIR = os.environ.get("WAKEUP_DATA_DIR", "/var/lib/wakeup-api/profiles")
MAX_BODY = 20 * 1024        # 요청 본문 최대 20KB
MAX_PROFILES = 500          # 프로필 파일 최대 개수 (디스크 보호)
MAX_CLASSES = 60            # 한 사람 수업 최대 개수
MAX_TEXT = 40               # 과목 · 강의실 글자 수
MAX_TIMES = 120             # 요일 유형별 직접 입력 버스 시각 최대 개수
MAX_MIN = 24 * 60           # 분 값 상한 (하루)
IMPORT_LIMIT = 10           # 에타 가져오기: 같은 IP 1분에 최대 횟수 (에타 서버에 부담 주지 않게)
ROUTE_LIMIT = 5             # 길찾기: 같은 IP 1분에 최대 횟수 (요청 1번에 ODsay 호출 최대 3번)
ROUTE_DAILY = 300           # 길찾기: 서버 전체 하루 최대 횟수 (ODsay 무료 한도 보호, 한도 확인 후 조정)

CODE_RE = re.compile(r"^[a-z0-9]{8}$")
HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,20}$")
ROUTE_ID_RE = re.compile(r"^[a-z0-9-]{1,40}$")
TOPIC_RE = re.compile(r"^[A-Za-z0-9_-]{0,64}$")

TOP_KEYS = {"version", "classes", "commute", "notify"}
CLASS_KEYS = {"id", "name", "day", "start", "end", "room"}
COMMUTE_KEYS = {"prepMin", "walkToStopMin", "walkToRoomMin", "bufferMin", "routeId", "customTimes"}
TRAVEL_KEYS = {"prepMin", "travelMin", "bufferMin"}    # 11/21 이동 시간 모드 (출발지 · 도착지는 저장하지 않음)
CUSTOM_KEYS = {"rideMin", "weekday", "saturday", "sunday"}
NOTIFY_KEYS = {"enabled", "channel", "topic", "sendAt"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY
app.json.ensure_ascii = False
lock = threading.Lock()


# ---------------------------------------------------------------- 응답 도우미
def error(status, message):
    return jsonify({"error": message}), status


@app.errorhandler(413)
def too_large(_e):
    return error(413, f"본문은 {MAX_BODY // 1024}KB 까지만 받을 수 있습니다")


@app.errorhandler(404)
def not_found(_e):
    return error(404, "없는 주소입니다")


@app.errorhandler(405)
def bad_method(_e):
    return error(405, "허용되지 않은 방식입니다")


# ---------------------------------------------------------------- 형식 검사
class Invalid(Exception):
    pass


def check_keys(obj, allowed, where):
    if not isinstance(obj, dict):
        raise Invalid(f"{where} 는 객체여야 합니다")
    extra = set(obj) - allowed
    if extra:
        raise Invalid(f"{where} 에 허용되지 않은 필드: {', '.join(sorted(extra))}")
    missing = allowed - set(obj)
    if missing:
        raise Invalid(f"{where} 에 빠진 필드: {', '.join(sorted(missing))}")


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def check_minutes(v, where, minimum=0):
    if not is_int(v) or v < minimum or v > MAX_MIN:
        raise Invalid(f"{where} 는 {minimum} 이상 {MAX_MIN} 이하의 정수(분)여야 합니다")


def check_hhmm(v, where):
    if not isinstance(v, str) or not HHMM_RE.match(v):
        raise Invalid(f"{where} 는 HH:MM (00:00~23:59) 형식이어야 합니다")


def to_min(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def check_text(v, where):
    if not isinstance(v, str) or len(v) > MAX_TEXT:
        raise Invalid(f"{where} 는 {MAX_TEXT}자 이하의 문자열이어야 합니다")


def validate_profile(p):
    """plan.md 2-1 형식인지 검사한다. 틀리면 Invalid 를 던진다."""
    check_keys(p, TOP_KEYS, "프로필")
    if p["version"] != 1:
        raise Invalid("version 은 1 이어야 합니다")

    classes = p["classes"]
    if not isinstance(classes, list) or len(classes) > MAX_CLASSES:
        raise Invalid(f"classes 는 {MAX_CLASSES}개 이하의 배열이어야 합니다")
    for i, c in enumerate(classes):
        where = f"classes[{i}]"
        check_keys(c, CLASS_KEYS, where)
        if not isinstance(c["id"], str) or not ID_RE.match(c["id"]):
            raise Invalid(f"{where}.id 형식이 올바르지 않습니다")
        check_text(c["name"], f"{where}.name")
        check_text(c["room"], f"{where}.room")
        if not is_int(c["day"]) or not 0 <= c["day"] <= 6:
            raise Invalid(f"{where}.day 는 0(일)~6(토) 정수여야 합니다")
        check_hhmm(c["start"], f"{where}.start")
        check_hhmm(c["end"], f"{where}.end")
        if to_min(c["start"]) >= to_min(c["end"]):
            raise Invalid(f"{where} 종료 시각이 시작 시각보다 늦어야 합니다")

    cm = p["commute"]
    if cm is None:              # 통학 정보 미입력 (11/21 개편: 선택 항목)
        cm = {}
    elif isinstance(cm, dict) and "travelMin" in cm:
        check_keys(cm, TRAVEL_KEYS, "commute")
        check_minutes(cm["prepMin"], "commute.prepMin")
        check_minutes(cm["travelMin"], "commute.travelMin", minimum=1)
        check_minutes(cm["bufferMin"], "commute.bufferMin")
        cm = {}
    else:
        check_keys(cm, COMMUTE_KEYS, "commute")
    if cm:
        validate_commute(cm)

    n = p["notify"]
    check_keys(n, NOTIFY_KEYS, "notify")
    if not isinstance(n["enabled"], bool):
        raise Invalid("notify.enabled 는 true/false 여야 합니다")
    if n["channel"] != "ntfy":
        raise Invalid('notify.channel 은 "ntfy" 만 지원합니다')
    if not isinstance(n["topic"], str) or not TOPIC_RE.match(n["topic"]):
        raise Invalid("notify.topic 은 영문 · 숫자 · _ · - 64자 이하여야 합니다")
    if n["enabled"] and not n["topic"]:
        raise Invalid("알림을 켜려면 notify.topic 이 필요합니다")
    check_hhmm(n["sendAt"], "notify.sendAt")


def validate_commute(cm):
    for k in ("prepMin", "walkToStopMin", "walkToRoomMin", "bufferMin"):
        check_minutes(cm[k], f"commute.{k}")
    ct = cm["customTimes"]
    if ct is None:
        if not isinstance(cm["routeId"], str) or not ROUTE_ID_RE.match(cm["routeId"]):
            raise Invalid("commute.routeId 형식이 올바르지 않습니다 (노선 선택 또는 직접 입력 필요)")
    else:
        if cm["routeId"] != "":
            raise Invalid("직접 입력(customTimes)을 쓰면 commute.routeId 는 빈 문자열이어야 합니다")
        check_keys(ct, CUSTOM_KEYS, "commute.customTimes")
        check_minutes(ct["rideMin"], "commute.customTimes.rideMin", minimum=1)
        for t in ("weekday", "saturday", "sunday"):
            lst = ct[t]
            if not isinstance(lst, list) or len(lst) > MAX_TIMES:
                raise Invalid(f"commute.customTimes.{t} 는 {MAX_TIMES}개 이하의 배열이어야 합니다")
            prev = -1
            for v in lst:
                check_hhmm(v, f"commute.customTimes.{t} 의 값")
                if to_min(v) <= prev:
                    raise Invalid(f"commute.customTimes.{t} 는 오름차순 · 중복 없이 써야 합니다")
                prev = to_min(v)


# ---------------------------------------------------------------- 저장소
def ensure_store():
    os.makedirs(DATA_DIR, mode=0o750, exist_ok=True)


def profile_path(code):
    # code 는 [a-z0-9]{8} 검사를 통과한 값만 들어온다 → 경로 조작 불가
    return os.path.join(DATA_DIR, code + ".json")


def count_profiles():
    return sum(1 for f in os.listdir(DATA_DIR) if f.endswith(".json") and not f.startswith("."))


def write_atomic(path, data):
    fd, tmp = tempfile.mkstemp(prefix=".profile-", suffix=".tmp", dir=DATA_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o640)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise
    dir_fd = os.open(DATA_DIR, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


# ---------------------------------------------------------------- API
@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.get("/api/profile/<code>")
def get_profile(code):
    if not CODE_RE.match(code):
        return error(400, "동기화 코드는 영문 소문자 · 숫자 8자리여야 합니다")
    path = profile_path(code)
    with lock:
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return error(404, "이 코드로 저장된 시간표가 없습니다")
        except (OSError, json.JSONDecodeError):
            return error(500, "저장된 시간표를 읽을 수 없습니다")
    resp = jsonify(data)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.put("/api/profile/<code>")
def put_profile(code):
    if not CODE_RE.match(code):
        return error(400, "동기화 코드는 영문 소문자 · 숫자 8자리여야 합니다")
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return error(400, "JSON 객체를 보내 주세요 (Content-Type: application/json)")
    try:
        validate_profile(data)
    except Invalid as e:
        return error(400, str(e))

    path = profile_path(code)
    with lock:
        ensure_store()
        if not os.path.exists(path) and count_profiles() >= MAX_PROFILES:
            return error(507, "서버 저장 공간이 가득 찼습니다. 관리자에게 알려 주세요")
        try:
            write_atomic(path, data)
        except OSError:
            return error(500, "저장에 실패했습니다")
    return jsonify({"ok": True, "code": code})


# ---------------------------------------------------------------- 에타 가져오기
_hits = {}                      # IP → 최근 요청 시각들
_hits_lock = threading.Lock()


def client_ip():
    # Nginx 가 X-Real-IP 로 실제 접속 IP 를 넘겨준다 (127.0.0.1 에서만 받으므로 신뢰 가능)
    return request.headers.get("X-Real-IP") or request.remote_addr or "?"


def too_many(ip, bucket="import", limit=IMPORT_LIMIT):
    now = time.monotonic()
    with _hits_lock:
        q = _hits.setdefault((bucket, ip), deque())
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= limit:
            return True
        q.append(now)
        if len(_hits) > 5000:   # 오래된 IP 기록 정리 (메모리 보호)
            for k in [k for k, v in _hits.items() if not v]:
                del _hits[k]
        return False


@app.post("/api/import/everytime")
def import_everytime():
    data = request.get_json(silent=True)
    url = data.get("url") if isinstance(data, dict) else None
    if not isinstance(url, str) or len(url) > 300:
        return jsonify({"error": everytime.MESSAGES["invalid_url"], "reason": "invalid_url"}), 400
    if too_many(client_ip()):
        return jsonify({"error": "요청이 너무 많아요. 1분 뒤 다시 시도해 주세요.", "reason": "rate_limited"}), 429
    try:
        result = everytime.import_timetable(url)
    except everytime.ImportError_ as e:
        status = {"invalid_url": 400, "not_found": 404, "private": 403, "empty": 422}.get(e.reason, 502)
        return jsonify({"error": e.message, "reason": e.reason}), status
    resp = jsonify({"ok": True, **result})
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------------------------------------------------------------- 통학 길찾기 (ODsay)
_daily = {"date": "", "count": 0}


def daily_exceeded():
    today = time.strftime("%Y-%m-%d")
    with _hits_lock:
        if _daily["date"] != today:
            _daily.update(date=today, count=0)
        if _daily["count"] >= ROUTE_DAILY:
            return True
        _daily["count"] += 1
        return False


def route_fail(status, reason, message):
    return jsonify({"error": message, "reason": reason}), status


@app.post("/api/commute/route")
def commute_route():
    data = request.get_json(silent=True)
    src = data.get("from") if isinstance(data, dict) else None
    dst = data.get("to") if isinstance(data, dict) else None
    if not all(isinstance(v, str) and 0 < len(v.strip()) <= MAX_TEXT for v in (src, dst)):
        return route_fail(400, "invalid", odsay.ROUTE_MESSAGES["invalid"])
    if too_many(client_ip(), "route", ROUTE_LIMIT) or daily_exceeded():
        return route_fail(429, "rate_limited", "요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.")
    try:
        result = odsay.route_minutes(src, dst)
    except odsay.RouteError as e:
        reason = "not_configured" if e.reason == "no_key" else e.reason
        status = {"invalid": 400, "not_found": 422, "no_route": 422, "not_configured": 503}.get(reason, 502)
        return route_fail(status, reason, e.message)
    resp = jsonify({"ok": True, **result})
    resp.headers["Cache-Control"] = "no-store"
    return resp


if __name__ == "__main__":
    ensure_store()
    app.run(host=HOST, port=PORT, debug=False)
