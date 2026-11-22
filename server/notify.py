"""전날 밤 브리핑 알림 (3단계) — ntfy 로 "내일 07:20 기상 · 08:05 버스" 발송

사용
  python3 notify.py                      cron 용: 발송 시각이 된 프로필에만 보냄 (하루 한 번)
  python3 notify.py --dry-run            보내지 않고, 알림 켠 프로필마다 보낼 문구만 출력
  python3 notify.py --now <code>         시연용: 그 코드의 알림을 지금 바로 보냄 (시각 · 중복 기록 무시)
  python3 notify.py --now <code> --dry-run

규칙 (plan.md 3단계 · 3장 경계 상황)
  - notify.enabled 이고 topic 이 있는 프로필만
  - 발송 시각(sendAt) ~ sendAt+15분 사이에 처음 실행될 때 한 번 (cron 이 한두 번 빠져도 놓치지 않게)
  - 같은 날 두 번 보내지 않음 (기록: /var/lib/wakeup-api/notify-sent.json)
  - 내일 수업이 없으면 보내지 않음
  - 기상 시각이 자정을 넘겨 '오늘 밤'이면 제목에 표시, 알림 시각보다 이르면 경고

환경 변수 (기본값)
  WAKEUP_DATA_DIR  /var/lib/wakeup-api/profiles
  WAKEUP_STATE     /var/lib/wakeup-api/notify-sent.json
  WAKEUP_BUS_DIR   <이 파일>/../site/data/bus
  NTFY_URL         https://ntfy.sh
  WAKEUP_TZ        Asia/Seoul
"""

import argparse
import fcntl
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import calc  # noqa: E402

DATA_DIR = os.environ.get("WAKEUP_DATA_DIR", "/var/lib/wakeup-api/profiles")
STATE_FILE = os.environ.get("WAKEUP_STATE", "/var/lib/wakeup-api/notify-sent.json")
BUS_DIR = os.environ.get("WAKEUP_BUS_DIR", os.path.join(HERE, "..", "site", "data", "bus"))
NTFY_URL = os.environ.get("NTFY_URL", "https://ntfy.sh").rstrip("/")
TZ = ZoneInfo(os.environ.get("WAKEUP_TZ", "Asia/Seoul"))
WINDOW_MIN = 15
DAY_NAME = ["일", "월", "화", "수", "목", "금", "토"]
CODE_RE = re.compile(r"^[a-z0-9]{8}$")
TOPIC_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
ROUTE_FILE_RE = re.compile(r"^route-[a-z0-9-]+\.json$")


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- 데이터 읽기
def load_profiles(verbose=True):
    """{code: profile} — 형식이 깨진 파일은 건너뜀
    (cron 에서는 verbose=False: 1분마다 같은 경고가 로그에 쌓이지 않게. 점검은 --dry-run 으로)"""
    out = {}
    try:
        names = sorted(os.listdir(DATA_DIR))
    except FileNotFoundError:
        return out
    for name in names:
        code = name[:-5]
        if not name.endswith(".json") or not CODE_RE.match(code):
            continue
        try:
            with open(os.path.join(DATA_DIR, name), encoding="utf-8") as f:
                out[code] = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            if verbose:
                log(f"[{code}] 프로필을 읽을 수 없음: {e}")
    return out


_routes_meta = None


def load_route(commute):
    """프로필 통학 설정에 맞는 노선 (직접 입력 우선) → (route, 표시 이름)"""
    global _routes_meta
    if commute.get("customTimes"):
        return calc.custom_to_route(commute["customTimes"]), "버스"
    if _routes_meta is None:
        with open(os.path.join(BUS_DIR, "routes.json"), encoding="utf-8") as f:
            _routes_meta = {r["id"]: r for r in json.load(f)}
    meta = _routes_meta.get(commute.get("routeId"))
    if not meta or not ROUTE_FILE_RE.match(meta.get("file", "")):
        raise ValueError(f"등록된 노선을 찾을 수 없음: {commute.get('routeId')}")
    with open(os.path.join(BUS_DIR, meta["file"]), encoding="utf-8") as f:
        route = json.load(f)
    name = route.get("name") or meta["id"]
    if route.get("isExample"):
        name += " (예시)"
    return route, name


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state):
    d = os.path.dirname(STATE_FILE)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".notify-", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, STATE_FILE)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


# ---------------------------------------------------------------- 문구 만들기
def js_day(dt):
    """datetime → 0=일 … 6=토 (JS getDay 와 같게)"""
    return (dt.weekday() + 1) % 7


def build_message(profile, now):
    """내일 브리핑 → {"title", "message"} 또는 None(내일 수업 없음)"""
    tomorrow = now + timedelta(days=1)
    day = js_day(tomorrow)
    dname = DAY_NAME[day]
    commute = profile.get("commute")
    if not commute:
        # 통학 정보 없음 (11/21 개편: 선택 항목) → 내일 첫 수업만 알림
        todays = calc.classes_of_day(profile["classes"], day)
        if not todays:
            return None
        fc = todays[0]
        line = f"첫 수업 {fc['start']} {fc.get('name') or '수업'}" + (f" ({fc['room']})" if fc.get("room") else "")
        return {"title": f"📚 내일({dname}) 첫 수업 {fc['start']}",
                "message": f"{line}\n수업 {len(todays)}개 · 통학 정보를 입력하면 기상 시각도 알려 드려요."}
    travel = calc.is_travel_mode(commute)           # 11/21 이동 시간 모드: 노선 파일 없이 계산
    route, route_name = (None, "") if travel else load_route(commute)
    r = calc.calc_day(profile["classes"], commute, route, day)

    if r["status"] == "no-class":
        return None

    fc = r["firstClass"]
    first_line = f"첫 수업 {fc['start']} {fc.get('name') or '수업'}" + (f" ({fc['room']})" if fc.get("room") else "")

    if r["status"] == "no-bus":
        return {"title": f"⚠️ 내일({dname}) 탈 버스가 없어요",
                "message": f"{first_line}\n등록된 버스 시각이 없어요. 등록 화면에서 노선을 확인해 주세요."}

    wake = r["wake"]
    if travel:
        lines = [f"{calc.label(r['departure'])} 출발 (이동 {commute['travelMin']}분 · 총 {calc.total_min(commute)}분)", first_line]
    else:
        lines = [f"{calc.label(r['departure'])} 출발 → {calc.label(r['bus'])} {route_name}", first_line]
    if wake < 0:
        tonight = wake + calc.DAY_MIN               # 오늘 밤 시각(분)
        title = f"⏰ 오늘 밤 {calc.to_clock(wake)[0]} 기상 (내일 {dname}요일 수업)"
        send_at = calc.to_min(profile["notify"]["sendAt"])
        if send_at is not None and tonight < send_at:
            lines.append(f"⚠️ 기상 시각이 알림 시각({profile['notify']['sendAt']})보다 빨라요. 알람을 확인해 주세요.")
    else:
        title = f"⏰ 내일({dname}) {calc.label(wake)} 기상"
    if r["status"] == "late":
        lines.append(f"⚠️ 첫차를 타도 약 {r['lateMin']}분 지각해요.")
    lines.append("폰 알람을 이 시각에 맞춰 주세요.")
    return {"title": title, "message": "\n".join(lines)}


# ---------------------------------------------------------------- 보내기
def send_ntfy(topic, msg):
    body = json.dumps({"topic": topic, "title": msg["title"], "message": msg["message"],
                       "tags": ["alarm_clock"]}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(NTFY_URL, data=body, method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "wakeup-notify"})
    with urllib.request.urlopen(req, timeout=10) as res:
        if res.status != 200:
            raise RuntimeError(f"ntfy 응답 {res.status}")


def due(profile, now, state, code):
    """지금 보낼 차례인지"""
    n = profile.get("notify") or {}
    if not n.get("enabled") or not TOPIC_RE.match(n.get("topic") or ""):
        return False
    send_at = calc.to_min(n.get("sendAt"))
    if send_at is None:
        return False
    now_min = now.hour * 60 + now.minute
    if not (send_at <= now_min < send_at + WINDOW_MIN):
        return False
    return state.get(code) != now.date().isoformat()


# ---------------------------------------------------------------- 실행 모드
def run_cron(now):
    lock_path = STATE_FILE + ".lock"
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    with open(lock_path, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0                                  # 이전 실행이 아직 도는 중
        profiles = load_profiles(verbose=False)
        state = load_state()
        changed = False
        for code, p in profiles.items():
            if not due(p, now, state, code):
                continue
            try:
                msg = build_message(p, now)
            except Exception as e:                    # 한 사람의 데이터 문제로 전체가 멈추지 않게
                log(f"[{code}] 문구 생성 실패: {e}")
                continue
            if msg is None:
                log(f"[{code}] 내일 수업 없음 → 보내지 않음")
            else:
                try:
                    send_ntfy(p["notify"]["topic"], msg)
                    log(f"[{code}] 발송: {msg['title']}")
                except (urllib.error.URLError, OSError, RuntimeError) as e:
                    log(f"[{code}] 발송 실패 (다음 실행에서 다시 시도): {e}")
                    continue
            state[code] = now.date().isoformat()     # 수업 없어 안 보낸 날도 기록 → 15분 동안 반복 로그 방지
            changed = True
        # 지워진 프로필 기록 정리
        for code in [c for c in state if c not in profiles]:
            del state[code]
            changed = True
        if changed:
            save_state(state)
    return 0


def run_dry(now):
    profiles = load_profiles()
    shown = 0
    for code, p in profiles.items():
        n = p.get("notify") or {}
        if not n.get("enabled"):
            continue
        shown += 1
        print_preview(code, p, now)
    if not shown:
        log("알림을 켠 프로필이 없습니다.")
    return 0


def print_preview(code, p, now):
    n = p.get("notify") or {}
    try:
        msg = build_message(p, now)
    except Exception as e:
        log(f"[{code}] 문구 생성 실패: {e}")
        return None
    log(f"[{code}] 토픽 {n.get('topic') or '(없음)'} · 발송 시각 {n.get('sendAt')}")
    if msg is None:
        log("  내일 수업 없음 → 보내지 않음")
    else:
        log("  제목: " + msg["title"])
        for line in msg["message"].split("\n"):
            log("  " + line)
    return msg


def run_now(code, now, dry):
    if not CODE_RE.match(code):
        log("코드는 영문 소문자 · 숫자 8자리여야 합니다")
        return 2
    p = load_profiles().get(code)
    if not p:
        log(f"[{code}] 저장된 프로필이 없습니다")
        return 1
    msg = print_preview(code, p, now)
    if dry or msg is None:
        return 0
    topic = (p.get("notify") or {}).get("topic") or ""
    if not TOPIC_RE.match(topic):
        log(f"[{code}] 알림 토픽이 없습니다. 등록 화면에서 토픽을 저장해 주세요.")
        return 1
    try:
        send_ntfy(topic, msg)
    except (urllib.error.URLError, OSError, RuntimeError) as e:
        log(f"[{code}] 발송 실패: {e}")
        return 1
    log(f"[{code}] 발송 완료 → ntfy 토픽 {topic}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="전날 밤 브리핑 알림 (ntfy)")
    ap.add_argument("--dry-run", action="store_true", help="보내지 않고 문구만 출력")
    ap.add_argument("--now", metavar="CODE", help="이 코드의 알림을 지금 바로 보냄 (시연용)")
    ap.add_argument("--at", metavar="YYYY-MM-DDTHH:MM", help="(테스트용) 지금 시각을 이 값으로 계산")
    args = ap.parse_args(argv)
    now = datetime.fromisoformat(args.at).replace(tzinfo=TZ) if args.at else datetime.now(TZ)
    if args.now:
        return run_now(args.now, now, args.dry_run)
    if args.dry_run:
        return run_dry(now)
    return run_cron(now)


if __name__ == "__main__":
    sys.exit(main())
