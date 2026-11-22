#!/usr/bin/env python3
"""
site-deploy 사전 점검 — deploy.sh 가 하지 않는 검사 두 가지 (배포 자체는 반드시 deploy.sh)

  python3 .claude/skills/site-deploy/precheck.py         점검만
  python3 .claude/skills/site-deploy/precheck.py --zip   확장 zip을 extension/ 기준으로 다시 만든 뒤 점검

  1. 외부 주소     site/ 의 http(s) 주소 호스트가 허용 목록뿐인지 (CDN 금지, CLAUDE.md 규칙 1). js/vendor/ 는 주석뿐이라 제외
  2. 확장 zip 최신 site/download/wakeup-extension.zip 안 파일이 extension/ (test/ · 숨김 제외)과 같은지
                   (확장만 고치고 zip을 안 만들면 대시보드 "확장 받기"로 예전 확장이 받아짐)
deploy.sh 가 하는 것(잠금 · 배포본 지문 · ?v= · 전체 테스트 · 백업 · 기록)은 여기서 다시 하지 않는다.
"""
import json, os, re, sys, zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SITE = os.path.join(ROOT, "site")
EXT = os.path.join(ROOT, "extension")
ZIP = os.path.join(SITE, "download", "wakeup-extension.zip")
ALLOWED_HOSTS = {
    "everytime.kr": "에타 공유 링크 입력 안내 (사용자가 붙여 넣는 주소)",
    "www.w3.org": "SVG 이름공간 (요청 안 함)",
    "www.icloud.com": "아이폰 단축어 설치 링크 (dashboard.js SHORTCUT_INSTALL_URL)",
}

results = []


def add(name, ok, detail=""):
    results.append((name, ok, detail))


def ext_payload():
    """zip에 들어갈 {zip 안 경로: 내용} (test/ · 숨김 제외, 최상위 폴더 wakeup-ext/)"""
    files = {}
    for d, dirs, fs in os.walk(EXT):
        dirs[:] = sorted(x for x in dirs if x != "test" and not x.startswith("."))
        for f in sorted(fs):
            if f.startswith("."):
                continue
            p = os.path.join(d, f)
            with open(p, "rb") as fh:
                files["wakeup-ext/" + os.path.relpath(p, EXT).replace(os.sep, "/")] = fh.read()
    return files


def build_zip():
    os.makedirs(os.path.dirname(ZIP), exist_ok=True)
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in ext_payload().items():
            z.writestr(name, data)
    v = json.loads(ext_payload()["wakeup-ext/manifest.json"])["version"]
    print("확장 zip 다시 만듦: site/download/wakeup-extension.zip (v%s) → site/ 가 바뀌었으니 deploy.sh 로 배포" % v)


def check_external():
    bad = []
    for d, _, fs in os.walk(SITE):
        for f in fs:
            r = os.path.relpath(os.path.join(d, f), SITE).replace(os.sep, "/")
            if not r.endswith((".html", ".js", ".css")) or r.startswith("js/vendor/"):
                continue
            with open(os.path.join(SITE, r), encoding="utf-8") as fh:
                for i, line in enumerate(fh, 1):
                    for host in re.findall(r"https?://([^/\s'\"<>)…]+)", line):
                        if host not in ALLOWED_HOSTS:
                            bad.append("%s:%d %s" % (r, i, host))
    add("외부 주소", not bad, ("허용 밖: " + ", ".join(bad[:5])) if bad else "허용: " + ", ".join(sorted(ALLOWED_HOSTS)))


def check_zip():
    if not os.path.exists(ZIP):
        add("확장 zip 최신", False, "zip 없음 → --zip")
        return
    want = ext_payload()
    with zipfile.ZipFile(ZIP) as z:
        have = {n: z.read(n) for n in z.namelist()}
    diff = sorted(set(want) ^ set(have)) + sorted(n for n in want if n in have and want[n] != have[n])
    v = json.loads(want["wakeup-ext/manifest.json"])["version"]
    add("확장 zip 최신", not diff,
        ("extension/과 다름: " + ", ".join(n.split("/", 1)[1] for n in diff[:5]) + " → --zip") if diff else "v" + v)


def main():
    if "--zip" in sys.argv[1:]:
        build_zip()
    check_external()
    check_zip()
    print("== site-deploy 사전 점검 ==")
    w = max(len(n) for n, _, _ in results)
    for n, ok, d in results:
        print("%s %s  %s" % ("PASS" if ok else "FAIL", n.ljust(w), d))
    fails = [n for n, ok, _ in results if not ok]
    print("결과: " + ("모두 통과 → sh deploy.sh --check" if not fails else "실패 %d개 (%s)" % (len(fails), ", ".join(fails))))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
