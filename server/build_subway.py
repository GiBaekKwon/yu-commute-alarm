"""대구 도시철도 2호선 시각표 CSV → 역별 '영남대까지 걸리는 시간' JSON (통학 시간 계산의 API 대체용)

입력 : docs/data/대구교통공사_2호선 열차시각표(하선)_20241010.csv  (CP949, 원본은 고치지 않음)
출력 : site/data/subway/line2.json
실행 : python3 server/build_subway.py   (결과 표와 docs/subway-timetable-v2.md 7장 값을 함께 출력)

계산 (docs/subway-timetable-v2.md 7장과 같은 방식)
  - 하선 = 문양 → 영남대 (등교 방향), 평일 열차만
  - 열차마다 (영남대 도착 − 그 역 출발) 을 구하고, 역별 중앙값(분, 소수 1자리)
  - 영남대 도착 칸이 빈 열차(중간 종착)는 제외, 자정(00:00:00) 도착은 다음 날로 처리
  - 환승역 이름의 노선 번호 꼬리표(반월당2 · 청라언덕2)는 뗀다
열차 탑승 시간만이다 (집 → 역 도보 · 열차 대기 · 역 → 강의실 도보 제외).
"""

import csv
import io
import json
import os
import statistics

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "docs", "data", "대구교통공사_2호선 열차시각표(하선)_20241010.csv")
OUT = os.path.join(HERE, "..", "site", "data", "subway", "line2.json")
END = "영남대"
DAY = "평일"


def sec(hms):
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


def clean(name):
    return name[:-1] if name.endswith("2") else name    # 반월당2 → 반월당, 청라언덕2 → 청라언덕


def build():
    with open(SRC, "rb") as f:
        rows = list(csv.reader(io.StringIO(f.read().decode("cp949"))))
    head, body = rows[0], [r for r in rows[1:] if r and r[0].startswith(DAY)]
    trains = range(3, len(head))
    end_row = next(r for r in body if r[1] == END and r[2] == "도착")

    order, mins = [], {}
    for r in body:
        if r[2] != "출발" or r[1] == END:
            continue
        name = clean(r[1])
        vals = []
        for i in trains:
            dep, arr = r[i].strip(), end_row[i].strip()
            if not dep or not arr:
                continue                                  # 이 역에 서지 않거나 영남대까지 가지 않는 열차
            d, a = sec(dep), sec(arr)
            if a < d:
                a += 24 * 3600                            # 자정 넘어 도착
            vals.append((a - d) / 60)
        if vals:
            order.append(name)
            mins[name] = round(statistics.median(vals), 1)

    return {
        "line": "대구 도시철도 2호선",
        "direction": "하선 (문양 → 영남대)",
        "to": END,
        "source": "대구교통공사 2호선 열차시각표(하선) CSV, 2024-10-10 기준 · 평일 열차의 역 출발 → 영남대 도착 중앙값",
        "note": "열차 탑승 시간만 포함 (집 → 역 도보 · 열차 대기 제외)",
        "stations": [{"name": n, "minutes": mins[n]} for n in order] + [{"name": END, "minutes": 0}],
    }


def main():
    data = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(data['stations'])}개 역 → {os.path.relpath(OUT, os.path.join(HERE, '..'))}")
    for s in data["stations"]:
        print(f"  {s['name']}\t{s['minutes']}")


if __name__ == "__main__":
    main()
