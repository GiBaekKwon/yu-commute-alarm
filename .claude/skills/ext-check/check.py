#!/usr/bin/env python3
"""
ext-check — 크롬 확장(extension/) 점검 스크립트

  python3 .claude/skills/ext-check/check.py          점검만
  python3 .claude/skills/ext-check/check.py --bump   점검 모두 통과하면 manifest 버전(패치) +1

검사 항목
  1. 로직 테스트      node extension/test/schedule.test.js
  2. JSON 형식        manifest.json · sample-profile.json
  3. JS 문법          extension/ 안의 모든 .js (node --check)
  4. 파일 참조        manifest(팝업 · 서비스 워커 · 아이콘) · popup.html <script>/<link> · importScripts 대상이 실제로 있는지
  5. 외부 주소        http(s) 주소는 host_permissions에 있는 서버만 (CDN 금지, MV3 원격 코드 금지)
  6. 서버 주소 일치   config.js API_BASE · WEB_BASE 호스트가 host_permissions에 있는지

마지막 점검 이후 바뀐 파일은 last-check.json(해시)과 비교해 알려 준다.
"""
import hashlib, json, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
EXT = os.path.join(ROOT, "extension")
STATE = os.path.join(os.path.dirname(__file__), "last-check.json")
SSH = {"user": "root", "host": "101.79.26.150", "port": 2222}

results = []  # (항목, 통과 여부, 설명)


def add(name, ok, detail=""):
    results.append((name, ok, detail))


def rel(p):
    return os.path.relpath(p, ROOT)


def ext_files(exts=None, skip_test=True):
    out = []
    for d, dirs, files in os.walk(EXT):
        if skip_test and os.path.relpath(d, EXT).split(os.sep)[0] == "test":
            continue
        for f in files:
            if exts is None or f.endswith(exts):
                out.append(os.path.join(d, f))
    return sorted(out)


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


# ---------- 1. 로직 테스트
r = subprocess.run(["node", os.path.join(EXT, "test", "schedule.test.js")], capture_output=True, text=True)
lines = [l for l in r.stdout.strip().splitlines() if l]
summary = lines[-1] if lines else (r.stderr.strip().splitlines() or ["출력 없음"])[-1]
fails = [l for l in lines if l.startswith("FAIL")]
add("로직 테스트", r.returncode == 0, summary + ("" if not fails else " — " + "; ".join(fails[:5])))

# ---------- 2. JSON 형식
manifest = None
for name in ("manifest.json", "sample-profile.json"):
    try:
        obj = json.loads(read(os.path.join(EXT, name)))
        if name == "manifest.json":
            manifest = obj
        add("JSON " + name, True)
    except Exception as e:  # noqa: BLE001
        add("JSON " + name, False, str(e))

# ---------- 3. JS 문법
bad = []
for p in ext_files((".js",), skip_test=False):
    c = subprocess.run(["node", "--check", p], capture_output=True, text=True)
    if c.returncode != 0:
        bad.append(rel(p) + ": " + (c.stderr.strip().splitlines() or ["?"])[-1])
add("JS 문법", not bad, "; ".join(bad) if bad else "%d개 파일" % len(ext_files((".js",), skip_test=False)))

# ---------- 4. 파일 참조
missing = []
if manifest:
    refs = []
    action = manifest.get("action", {})
    refs.append(action.get("default_popup"))
    refs += list(action.get("default_icon", {}).values())
    refs += list(manifest.get("icons", {}).values())
    refs.append(manifest.get("background", {}).get("service_worker"))
    popup = action.get("default_popup")
    if popup and os.path.exists(os.path.join(EXT, popup)):
        html = read(os.path.join(EXT, popup))
        refs += re.findall(r'<script[^>]+src="([^"]+)"', html)
        refs += re.findall(r'<link[^>]+href="([^"]+)"', html)
    sw = manifest.get("background", {}).get("service_worker")
    if sw and os.path.exists(os.path.join(EXT, sw)):
        for args in re.findall(r"importScripts\(([^)]*)\)", read(os.path.join(EXT, sw))):
            refs += re.findall(r'"([^"]+)"', args)
    for ref in refs:
        if ref and not re.match(r"^https?://", ref) and not os.path.exists(os.path.join(EXT, ref)):
            missing.append(ref)
    add("파일 참조", not missing, ("없는 파일: " + ", ".join(missing)) if missing else "%d개 참조" % len([x for x in refs if x]))
else:
    add("파일 참조", False, "manifest.json을 읽지 못함")

# ---------- 5. 외부 주소
hosts = []
for pat in (manifest or {}).get("host_permissions", []):
    m = re.match(r"^(https?://[^/]+)/", pat)
    if m:
        hosts.append(m.group(1))
offenders = []
for p in ext_files((".js", ".html", ".json", ".css")):
    for i, line in enumerate(read(p).splitlines(), 1):
        for url in re.findall(r"https?://[^\s\"'<>)]+", line):
            if "<" in line[line.find(url):line.find(url) + len(url) + 1]:
                continue  # 주석의 "http://<공인 IP>" 같은 자리 표시
            if not any(url.startswith(h + "/") or url == h for h in hosts):
                offenders.append("%s:%d %s" % (rel(p), i, url))
add("외부 주소", not offenders, "; ".join(offenders) if offenders else "허용: " + (", ".join(hosts) or "없음"))

# ---------- 6. config.js ↔ host_permissions
cfg = read(os.path.join(EXT, "config.js"))
problems = []
for key in ("API_BASE", "WEB_BASE"):
    vals = [v for v in re.findall(key + r'\s*:\s*"([^"]*)"', cfg) if "<" not in v]  # 주석의 자리 표시 제외
    val = vals[-1] if vals else ""
    if not val:
        problems.append(key + " 비어 있음")
        continue
    h = re.match(r"^(https?://[^/]+)", val)
    if not h or h.group(1) not in hosts:
        problems.append(key + " 호스트가 host_permissions에 없음")
add("서버 주소 일치", not problems, "; ".join(problems) if problems else "config.js ↔ manifest 일치")

# ---------- 결과 · 버전 · 바뀐 파일
all_ok = all(ok for _, ok, _ in results)
mpath = os.path.join(EXT, "manifest.json")
version = (manifest or {}).get("version", "?")
bumped = None
if all_ok and "--bump" in sys.argv and manifest:
    parts = version.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    new = ".".join(parts)
    text = read(mpath)
    text = re.sub(r'("version"\s*:\s*")[^"]+(")', r"\g<1>" + new + r"\g<2>", text, count=1)
    with open(mpath, "w", encoding="utf-8") as f:
        f.write(text)
    bumped = (version, new)
    version = new

hashes = {rel(p): hashlib.sha1(open(p, "rb").read()).hexdigest() for p in ext_files()}
try:
    prev = json.loads(read(STATE)).get("hashes", {})
except Exception:  # noqa: BLE001
    prev = None
if prev is None:
    changed = None
else:
    changed = sorted([f for f in hashes if prev.get(f) != hashes[f]] + ["(삭제) " + f for f in prev if f not in hashes])
if all_ok:
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump({"version": version, "hashes": hashes}, f, ensure_ascii=False, indent=1)

print("== ext-check ==")
for name, ok, detail in results:
    print("%s %-14s %s" % ("PASS" if ok else "FAIL", name, detail))
print()
print("결과: " + ("모두 통과" if all_ok else "실패 있음 — 버전을 올리지 않음"))
print("버전: " + ("%s → %s" % bumped if bumped else version))
if changed is None:
    print("바뀐 파일: (첫 점검이라 비교 기준 없음)")
else:
    print("바뀐 파일: " + (", ".join(changed) if changed else "없음"))
if changed and any(f.endswith("sample-profile.json") for f in changed):
    print("주의: 예시 데이터가 바뀜 → 팝업에서 '코드 변경 → 예시 데이터로 보기'를 다시 눌러야 반영")
print()
print("PC 동기화 (PowerShell):")
print('scp -P %d -r "%s@%s:%s/*" "$HOME\\wakeup-ext\\"' % (SSH["port"], SSH["user"], SSH["host"], EXT))
sys.exit(0 if all_ok else 1)
