"""에타 가져오기 테스트 (plan.md A-2 · A-6)

실행
  python3 tests/test_import.py                 파서 + API(가짜 에타 응답) 검사
  python3 tests/test_import.py --live <URL>    실제 공개 링크 1회 가져오기 (원문은 저장 · 출력하지 않고 변환 결과만)
"""

import copy
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "..", "server")
sys.path.insert(0, SERVER)
os.environ.setdefault("WAKEUP_DATA_DIR", tempfile.mkdtemp(prefix="wakeup-test-"))

import everytime  # noqa: E402
import app as A   # noqa: E402

FIXTURE = open(os.path.join(HERE, "fixtures", "everytime-public.xml"), "rb").read()
SAMPLE = json.load(open(os.path.join(HERE, "..", "site", "data", "sample-timetable.json"), encoding="utf-8"))
ok = bad = 0


def check(name, actual, expected):
    global ok, bad
    if actual == expected:
        ok += 1
        print("PASS", name)
    else:
        bad += 1
        print("FAIL", name, "\n     기대", expected, "\n     실제", actual)


def reason_of(fn):
    try:
        fn()
    except everytime.ImportError_ as e:
        return e.reason
    return None


def xml(body):
    return ('<?xml version="1.0" encoding="UTF-8"?><response>' + body + "</response>").encode()


def run_unit():
    # 주소 형식
    for u, ident in [("https://everytime.kr/@Abcd1234Efgh5678Ijkl", "Abcd1234Efgh5678Ijkl"),
                     ("  everytime.kr/@abc123  ", "abc123"),
                     ("https://www.everytime.kr/@abc123/", "abc123"),
                     ("https://everytime.kr/@abc123?utm=x", "abc123")]:
        check(f"주소 인식 {u.strip()!r}", everytime.parse_url(u), ident)
    for u in ["", "https://everytime.kr/", "https://evil.com/@abc", "https://everytime.kr.evil.com/@abc",
              "https://everytime.kr/@abc/../x", "https://everytime.kr/@ab c", "javascript:alert(1)", None]:
        check(f"잘못된 주소 거부 {u!r}", reason_of(lambda: everytime.parse_url(u)), "invalid_url")

    # 시각 변환 (5분 단위)
    check("5분 단위 → HH:MM", [everytime.unit_to_hhmm(x) for x in (108, 126, 226, 255, 0, 288)],
          ["09:00", "10:30", "18:50", "21:15", "00:00", "23:59"])

    # 픽스처 변환
    r = everytime.parse_xml(FIXTURE)
    check("학기", (r["year"], r["semester"]), ("2026", "2"))
    check("시간 칸 하나 = 수업 하나, 월→일 · 시작 순 정렬", [(c["name"], c["day"], c["start"], c["end"]) for c in r["classes"]], [
        ("자료구조", 1, "10:30", "11:45"),
        ("캡스톤디자인", 2, "18:50", "21:15"),
        ("자료구조", 3, "09:00", "10:15"),
        ("토요특강", 6, "09:00", "12:00"),
    ])
    check("강의실: 시간 칸 place 우선, 비면 과목 place", [c["room"] for c in r["classes"]], ["E21-101", "E21-102", "E21-101", "E21-103"])
    check("id e1… · 필드는 6개만", [sorted(c) for c in r["classes"]][0], ["day", "end", "id", "name", "room", "start"])
    check("시간 없는 과목은 제외 목록으로", r["skipped"], ["온라인교양"])
    text = json.dumps(r, ensure_ascii=False)
    check("이름 · 교수명 · 학점 · 내부코드는 결과에 없음", [w in text for w in ("가짜사용자", "홍길동", "김철수", "FAKE001", "credit")], [False] * 5)
    check("겹침 없음", r["warnings"], [])
    check("변환 결과가 프로필 검사 통과 (서버 형식)", _valid_profile(r["classes"]), True)

    # 실패 응답
    check("없는 시간표 (-1)", reason_of(lambda: everytime.parse_xml(xml("-1"))), "not_found")
    check("비공개 (status -2)", reason_of(lambda: everytime.parse_xml(xml('<table status="-2" year="2026" semester="2"/>'))), "private")
    check("그 학기 시간표 없음 (status -1)", reason_of(lambda: everytime.parse_xml(xml('<table status="-1" year="2026" semester="2"/>'))), "empty")
    check("수업 0개", reason_of(lambda: everytime.parse_xml(xml('<table status="1"><subject><name value="a"/><time value=""/></subject></table>'))), "empty")
    check("XML 아님 (에타 점검 페이지 등)", reason_of(lambda: everytime.parse_xml(b"<html>maintenance</html>")), "upstream")
    check("깨진 XML", reason_of(lambda: everytime.parse_xml(b"<response><table")), "upstream")

    # 겹침 경고
    over = xml('<table status="1"><subject><name value="A"/><time><data day="0" starttime="108" endtime="126" place=""/></time></subject>'
               '<subject><name value="B"/><time><data day="0" starttime="120" endtime="140" place=""/></time></subject></table>')
    w = everytime.parse_xml(over)["warnings"]
    check("같은 요일 겹침 → 경고", len(w) == 1 and "월요일" in w[0], True)
    # 같은 칸 중복
    dup = xml('<table status="1"><subject><name value="A"/><time><data day="0" starttime="108" endtime="126" place="x"/>'
              '<data day="0" starttime="108" endtime="126" place="x"/></time></subject></table>')
    check("같은 칸 중복 제거", len(everytime.parse_xml(dup)["classes"]), 1)
    # 긴 이름 자르기
    long = xml('<table status="1"><subject><name value="' + "가" * 60 + '"/><time><data day="4" starttime="108" endtime="126" place=""/></time></subject></table>')
    check("과목명 40자로 자름 · 금요일 변환", (len(everytime.parse_xml(long)["classes"][0]["name"]), everytime.parse_xml(long)["classes"][0]["day"]), (40, 5))


def _valid_profile(classes):
    p = copy.deepcopy(SAMPLE)
    p["classes"] = classes
    p["commute"] = None
    try:
        A.validate_profile(p)
        return True
    except A.Invalid as e:
        print("     ", e)
        return False


def run_api():
    c = A.app.test_client()
    calls = []

    def fake_fetch(identifier):
        calls.append(identifier)
        return {"privateone": xml('<table status="-2" year="2026" semester="2"/>'),
                "missing": xml("-1")}.get(identifier, FIXTURE)

    orig = everytime.fetch_xml
    everytime.import_timetable.__defaults__ = (fake_fetch,)
    try:
        def post(url, ip="1.1.1.1"):
            return c.post("/api/import/everytime", json={"url": url}, headers={"X-Real-IP": ip})
        r = post("https://everytime.kr/@okLink123")
        check("API 성공 200 · 수업 4개 · 저장하지 않음", (r.status_code, len(r.json["classes"]), os.listdir(A.DATA_DIR) if os.path.isdir(A.DATA_DIR) else []), (200, 4, []))
        check("API 응답에 이름 없음", "가짜사용자" in r.get_data(as_text=True), False)
        check("API 캐시 금지", r.headers.get("Cache-Control"), "no-store")
        for url, code, reason in [("https://everytime.kr/@privateone", 403, "private"),
                                  ("https://everytime.kr/@missing", 404, "not_found"),
                                  ("https://naver.com/@x", 400, "invalid_url")]:
            r = post(url)
            check(f"API 실패 {reason} → {code} + 안내", (r.status_code, r.json["reason"], bool(r.json["error"])), (code, reason, True))
        r = c.post("/api/import/everytime", data="x", content_type="application/json")
        check("API 본문 JSON 아님 → 400", r.status_code, 400)
        check("잘못된 주소는 에타에 요청 안 함", "x" in calls, False)
        # 요청 과다 (같은 IP 1분 10회)
        A._hits.clear()
        codes = [post("https://everytime.kr/@okLink123", ip="9.9.9.9").status_code for _ in range(11)]
        check("같은 IP 11번째 → 429", (codes[:10] == [200] * 10, codes[10]), (True, 429))
        check("다른 IP 는 영향 없음", post("https://everytime.kr/@okLink123", ip="8.8.8.8").status_code, 200)
        r = post("https://everytime.kr/@okLink123", ip="9.9.9.9")
        check("429 안내 문구 · reason", (r.json["reason"], "1분 뒤" in r.json["error"]), ("rate_limited", True))
    finally:
        everytime.import_timetable.__defaults__ = (orig,)

    # 에타 서버 무응답 → upstream
    def boom(_):
        everytime.fail("upstream")
    everytime.import_timetable.__defaults__ = (boom,)
    try:
        A._hits.clear()
        r = c.post("/api/import/everytime", json={"url": "https://everytime.kr/@abc"}, headers={"X-Real-IP": "2.2.2.2"})
        check("에타 무응답 → 502 upstream", (r.status_code, r.json["reason"]), (502, "upstream"))
    finally:
        everytime.import_timetable.__defaults__ = (orig,)

    # 통학 정보 없는 프로필 저장 (commute null)
    p = copy.deepcopy(SAMPLE)
    p["commute"] = None
    r = c.put("/api/profile/abcd2345", json=p)
    check("commute null 프로필 저장 200", r.status_code, 200)
    p["commute"] = {}
    check("commute 빈 객체는 거부 400", c.put("/api/profile/abcd2345", json=p).status_code, 400)


def run_live(url):
    print("실제 링크 가져오기 (원문은 출력 · 저장하지 않음)")
    try:
        r = everytime.import_timetable(url)
    except everytime.ImportError_ as e:
        print("실패:", e.reason, "-", e.message)
        return 1
    names = ["일", "월", "화", "수", "목", "금", "토"]
    print(f"{r['year']}년 {r['semester']}학기 · 수업 {len(r['classes'])}개 · 제외 {len(r['skipped'])}개 · 경고 {len(r['warnings'])}개")
    for c in r["classes"]:
        print(f"  {names[c['day']]} {c['start']}–{c['end']} {c['name']} · {c['room']}")
    ok_profile = _valid_profile(r["classes"])
    print("프로필 검사:", "통과" if ok_profile else "실패")
    return 0 if ok_profile else 1


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--live":
        sys.exit(run_live(sys.argv[2]))
    run_unit()
    run_api()
    print(f"==> {ok} / {ok + bad} PASS", "✅" if not bad else "❌")
    sys.exit(1 if bad else 0)
