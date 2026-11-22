"""에브리타임 공개 공유 링크 → 시간표 변환 (메인 기능, plan.md A-2)

확인 근거 (2026-11-21)
  - 에타 공유 페이지 스크립트 timetable.tableload.js:
      공유 주소 /@<identifier> → POST https://api.everytime.kr/find/timetable/table/friend
      (identifier, friendInfo) → XML. <response>-1</response> = 없는 시간표,
      table@status -1 = 그 학기 시간표 없음, -2 = 공개되지 않은 시간표.
      시각은 5분 단위(time/12 = 시, time%12*5 = 분), 요일 0=월 … 6=일.
  - 실제 공개 링크 응답: table > subject > name@value, place@value, time > data@day/starttime/endtime/place
    subject 의 place 는 "E21-114, E21-114"처럼 시간 칸 수만큼 합쳐져 있음 → data@place 를 우선 사용.

개인정보: friendInfo=false 로 요청해 사용자 이름(<user name>)을 받지 않는다.
교수명 · 학점 · 내부 코드는 읽지 않는다. 결과에는 과목명 · 요일 · 시각 · 강의실만 담는다.
"""

import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

API_URL = "https://api.everytime.kr/find/timetable/table/friend"
TIMEOUT = 8                    # 초
MAX_RESPONSE = 512 * 1024      # 응답 최대 크기
MAX_CLASSES = 60               # app.py 와 같은 한도
MAX_TEXT = 40

# https://everytime.kr/@식별자 (http · www · m. · 끝의 / · ?쿼리 · #조각 허용, 앞뒤 공백 허용)
URL_RE = re.compile(r"^(?:https?://)?(?:www\.|m\.)?everytime\.kr/@([A-Za-z0-9]{1,64})/?(?:[?#].*)?$")


class ImportError_(Exception):
    """가져오기 실패. reason 은 화면 안내용 코드 (plan.md A-2 표)"""

    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason
        self.message = message


MESSAGES = {
    "invalid_url": "에타 시간표 공유 링크(https://everytime.kr/@…)를 붙여 주세요.",
    "not_found": "존재하지 않는 시간표예요. 링크를 다시 복사해 주세요.",
    "private": "공개되지 않은 시간표예요. 에타 시간표 설정에서 공개 범위를 '전체 공개'로 바꾼 뒤 다시 시도해 주세요.",
    "empty": "가져올 수업이 없어요. 이번 학기 시간표에 수업이 있는지 확인해 주세요.",
    "upstream": "에브리타임에서 시간표를 받지 못했어요. 잠시 뒤 다시 시도해 주세요.",
}


def fail(reason):
    raise ImportError_(reason, MESSAGES[reason])


def parse_url(url):
    """공유 링크 → 식별자. 틀리면 ImportError_(invalid_url)"""
    m = URL_RE.match((url or "").strip()) if isinstance(url, str) else None
    if not m:
        fail("invalid_url")
    return m.group(1)


def unit_to_hhmm(unit):
    """에타 5분 단위 → "HH:MM" (24:00 이상은 23:59 로 맞춤)"""
    minutes = min(int(unit) * 5, 23 * 60 + 59)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _value(el, tag):
    child = el.find(tag)
    v = child.get("value") if child is not None else None
    return (v or "").strip()


def parse_xml(raw):
    """에타 XML → {year, semester, classes, skipped, warnings}. 실패하면 ImportError_"""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        fail("upstream")
    if root.tag != "response":
        fail("upstream")
    table = root.find("table")
    if table is None:
        code = (root.text or "").strip()
        fail("not_found" if code == "-1" else "upstream")

    status = table.get("status")
    if status == "-2":
        fail("private")
    if status == "-1":
        fail("empty")

    classes, skipped, seen = [], [], set()
    for subject in table.findall("subject"):
        name = _value(subject, "name")[:MAX_TEXT] or "이름 없는 과목"
        subject_place = _value(subject, "place")
        slots = subject.findall("time/data")
        added = False
        for d in slots:
            try:
                day = int(d.get("day"))
                start, end = int(d.get("starttime")), int(d.get("endtime"))
            except (TypeError, ValueError):
                continue
            if not 0 <= day <= 6 or not 0 <= start < end:
                continue
            room = (d.get("place") or "").strip()
            if not room and "," not in subject_place:
                room = subject_place
            item = {
                "name": name,
                "day": (day + 1) % 7,            # 에타 0=월 → 우리 0=일 … 6=토
                "start": unit_to_hhmm(start),
                "end": unit_to_hhmm(end),
                "room": room[:MAX_TEXT],
            }
            key = (item["name"], item["day"], item["start"], item["end"])
            if key in seen:                       # 같은 칸 중복 제거
                added = True
                continue
            if item["start"] >= item["end"]:
                continue
            seen.add(key)
            classes.append(item)
            added = True
        if not added:
            skipped.append(name)                   # 시간 없는 과목 (온라인 강의 등)

    if not classes:
        fail("empty")

    order = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6}
    classes.sort(key=lambda c: (order[c["day"]], c["start"], c["name"]))
    warnings = []
    if len(classes) > MAX_CLASSES:
        warnings.append(f"수업이 너무 많아 앞의 {MAX_CLASSES}개만 가져왔어요.")
        classes = classes[:MAX_CLASSES]
    for i, c in enumerate(classes, 1):
        c["id"] = f"e{i}"
    warnings += overlap_warnings(classes)
    return {
        "year": table.get("year") or "",
        "semester": table.get("semester") or "",
        "classes": [{k: c[k] for k in ("id", "name", "day", "start", "end", "room")} for c in classes],
        "skipped": skipped,
        "warnings": warnings,
    }


def overlap_warnings(classes):
    names = ["일", "월", "화", "수", "목", "금", "토"]
    out = []
    for d in range(7):
        todays = sorted((c for c in classes if c["day"] == d), key=lambda c: c["start"])
        for a, b in zip(todays, todays[1:]):
            if b["start"] < a["end"]:
                out.append(f"{names[d]}요일 {a['name']}({a['start']}–{a['end']})과 {b['name']}({b['start']}–{b['end']})의 시간이 겹쳐요.")
    return out


def fetch_xml(identifier):
    """에타 API 호출 → XML 바이트. 실패하면 ImportError_(upstream / not_found)"""
    body = urllib.parse.urlencode({"identifier": identifier, "friendInfo": "false"}).encode()
    req = urllib.request.Request(API_URL, data=body, method="POST", headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (compatible; wakeup-timetable-import)",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            raw = res.read(MAX_RESPONSE + 1)
    except urllib.error.HTTPError as e:
        fail("not_found" if e.code == 404 else "upstream")
    except (urllib.error.URLError, OSError):
        fail("upstream")
    if len(raw) > MAX_RESPONSE:
        fail("upstream")
    return raw


def import_timetable(url, fetch=fetch_xml):
    """공유 링크 → 변환 결과. fetch 는 테스트에서 바꿔 끼울 수 있다."""
    identifier = parse_url(url)
    return parse_xml(fetch(identifier))
