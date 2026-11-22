"""기상 시각 계산 — site/js/calc.js 와 같은 규칙의 파이썬 버전 (3단계 알림용)

규칙 (plan.md 3장)
  도착 목표 = 그날 첫 수업 시작 − 하차 후 강의실 도보 − 여유 시간
  탑승 한계 = 도착 목표 − 버스 소요 시간
  탈 버스   = 그날 요일 유형(평일/토/일) 시각 중 탑승 한계 이하인 가장 늦은 버스
  출발 시각 = 탈 버스 − 집→정류장 도보
  기상 시각 = 출발 시각 − 준비 시간

11/21 추가 — 이동 시간 모드 (commute 에 travelMin 이 있으면, route 는 쓰지 않음)
  출발 시각 = 그날 첫 수업 시작 − 여유 시간 − 이동 시간
  기상 시각 = 출발 시각 − 준비 시간          (총 소요 = 준비 + 이동 + 여유)

요일은 JS getDay() 와 같이 0=일 … 6=토. 시각 값은 그날 0시 기준 분 (음수 = 전날).
calc.js 를 바꾸면 이 파일과 calc_cases.json 도 함께 고치고 test_calc.py 로 두 결과가 같은지 확인한다.
"""

import re

DAY_MIN = 24 * 60
_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


# ---------------------------------------------------------------- time.js 대응
def to_min(hhmm):
    """"HH:MM" → 분. 형식이 틀리면 None"""
    m = _HHMM.match(hhmm) if isinstance(hhmm, str) else None
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def to_clock(minutes):
    """분 → ("HH:MM", dayOffset)"""
    day_offset = minutes // DAY_MIN          # 파이썬 // 는 음수에서도 내림 (JS Math.floor 와 같음)
    in_day = minutes - day_offset * DAY_MIN
    return f"{in_day // 60:02d}:{in_day % 60:02d}", day_offset


def label(minutes):
    text, off = to_clock(minutes)
    if off < 0:
        return "전날 " + text
    if off > 0:
        return "다음날 " + text
    return text


# ---------------------------------------------------------------- calc.js 대응
def day_type(day):
    if day == 0:
        return "sunday"
    if day == 6:
        return "saturday"
    return "weekday"


def classes_of_day(classes, day):
    todays = [c for c in (classes or []) if c.get("day") == day]
    return sorted(todays, key=lambda c: to_min(c["start"]))


def bus_times(route, day):
    lst = ((route or {}).get("times") or {}).get(day_type(day)) or []
    return sorted(to_min(t) for t in lst)


def _num(v):
    return 0 if v is None or v == "" else int(v)


def is_travel_mode(commute):
    """이동 시간 모드인지 (calc.js isTravelMode 와 같음)"""
    return isinstance(commute, dict) and "travelMin" in commute


def total_min(commute):
    """총 소요 시간(분) = 준비 + 이동 + 여유"""
    return _num(commute.get("prepMin")) + _num(commute.get("travelMin")) + _num(commute.get("bufferMin"))


def calc_day(classes, commute, route, day):
    """calc.js calcDay 와 같은 결과(dict)를 돌려준다. status: no-class · no-bus · ok · late"""
    todays = classes_of_day(classes, day)
    base = {"day": day, "dayType": day_type(day), "classes": todays}
    if not todays:
        base["status"] = "no-class"
        return base

    first = todays[0]
    class_start = to_min(first["start"])
    if is_travel_mode(commute):                      # 이동 시간 모드: 버스 시각표 없이 바로 거꾸로 계산
        arrive_target = class_start - _num(commute.get("bufferMin"))
        departure = arrive_target - _num(commute.get("travelMin"))
        base.update(firstClass=first, classStart=class_start, arriveTarget=arrive_target,
                    departure=departure, wake=departure - _num(commute.get("prepMin")), status="ok", lateMin=0)
        return base
    walk_to_room = _num(commute.get("walkToRoomMin"))
    buffer = _num(commute.get("bufferMin"))
    walk_to_stop = _num(commute.get("walkToStopMin"))
    prep = _num(commute.get("prepMin"))
    ride = _num(route.get("rideMin"))

    arrive_target = class_start - walk_to_room - buffer
    board_limit = arrive_target - ride
    times = bus_times(route, day)

    base.update(firstClass=first, classStart=class_start, arriveTarget=arrive_target, boardLimit=board_limit)
    if not times:
        base["status"] = "no-bus"
        return base

    candidates = [t for t in times if t <= board_limit]
    late = 0
    if candidates:
        bus = candidates[-1]
    else:
        bus = times[0]                               # 첫차 기준
        late = bus + ride + walk_to_room - class_start

    base["status"] = "late" if late > 0 else "ok"
    base["bus"] = bus
    base["lateMin"] = max(0, late)
    base["departure"] = bus - walk_to_stop
    base["wake"] = base["departure"] - prep
    return base


def check_now(day_result, commute, route, now):
    """calc.js checkNow 와 같음. status: none · on-time · missed · no-more-bus"""
    if not day_result or day_result.get("status") not in ("ok", "late"):
        return {"status": "none"}
    if now <= day_result["departure"]:
        return {"status": "on-time", "bus": day_result.get("bus"), "departure": day_result["departure"]}
    if is_travel_mode(commute):                      # 지금 나서면: 도착 = 지금 + 이동 시간
        arrival = now + _num(commute.get("travelMin"))
        return {"status": "missed", "arrival": arrival, "lateMin": max(0, arrival - day_result["classStart"])}
    times = bus_times(route, day_result["day"])
    earliest = now + _num(commute.get("walkToStopMin"))
    nxt = next((t for t in times if t >= earliest), None)
    if nxt is None:
        return {"status": "no-more-bus"}
    late = nxt + _num(route.get("rideMin")) + _num(commute.get("walkToRoomMin")) - day_result["classStart"]
    return {"status": "missed", "nextBus": nxt, "lateMin": max(0, late)}


def custom_to_route(ct):
    """프로필의 직접 입력 버스 시각 → 노선 형식 (storage.js customToRoute 와 같음)"""
    return {
        "id": "custom", "name": "직접 입력", "rideMin": ct.get("rideMin"),
        "times": {k: ct.get(k) or [] for k in ("weekday", "saturday", "sunday")},
    }
