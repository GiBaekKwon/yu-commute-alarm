#!/bin/sh
# 영남대 통학 기상 알리미 — 웹 배포 (site/ → /var/www/html/wakeup/)  ※ 배포는 이 스크립트로만 한다 (손으로 cp 금지)
#
#   sh deploy.sh             검사 → 테스트 → 바뀌는 파일 목록 → y 입력 → 백업 → 배포
#   sh deploy.sh --check     배포하지 않고 검사 · 바뀌는 파일 목록만
#   sh deploy.sh --yes       확인 질문 없이 (검사 · 테스트는 그대로)
#   sh deploy.sh --force     배포본이 이 스크립트 밖에서 바뀌었어도 덮어씀 (팀에 먼저 물어볼 것)
#
# 섞이지 않게 하는 장치
#   1. 잠금(flock): 두 사람이 동시에 배포하면 뒤 사람은 바로 멈춘다.
#   2. 배포본 지문(manifest): 마지막 배포 때 파일 지문을 저장해 두고, 그 뒤 누가 직접 복사해 바꿨으면 멈춘다.
#   3. ?v= 검사: JS · CSS 가 바뀌었는데 site/*.html 의 ?v= 가 배포본과 같으면 멈춘다 (캐시 때문에 섞여 보임).
#   4. 테스트 중 site/ 가 바뀌면 멈춘다 (다른 사람이 고치는 도중인 파일이 섞이는 것 방지). 테스트한 그대로를 복사한다.
#   5. 기록: /var/lib/wakeup-deploy/deploy.log 에 시각 · 사람 · 버전 · 바뀐 파일 수.
# 삭제는 하지 않는다 (rm -rf · rsync --delete 없음). 백업 폴더 정리는 사람에게 묻는다 (CLAUDE.md).
set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)
SITE="$ROOT/site"
DEST=/var/www/html/wakeup
STATE=/var/lib/wakeup-deploy
MANIFEST="$STATE/manifest.sha256"
LOG="$STATE/deploy.log"
STAGE="$STATE/stage"
CHECK=0; YES=0; FORCE=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;; --yes) YES=1 ;; --force) FORCE=1 ;;
    *) echo "모르는 옵션: $a (사용법은 파일 맨 위 주석)"; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
stop() { say "❌ $*"; exit 1; }
hash_dir() { (cd "$1" && find . -type f ! -name '.*' -print0 | sort -z | xargs -0 sha256sum); }
html_ver() { grep -oh '?v=[0-9A-Za-z_-]*' "$1"/*.html 2>/dev/null | sort -u; }

mkdir -p "$STATE"
exec 9>"$STATE/deploy.lock"
flock -n 9 || stop "다른 사람이 지금 배포 중이에요. 끝난 뒤 다시 실행해 주세요."

# ---- 1. 배포본이 마지막 배포 이후 밖에서 바뀌었는가
if [ -f "$MANIFEST" ]; then
  if ! (cd "$DEST" && sha256sum -c --quiet "$MANIFEST" >/dev/null 2>&1); then
    say "⚠️  배포본이 마지막 deploy.sh 이후 직접 바뀌었어요 (누군가 손으로 복사함):"
    (cd "$DEST" && sha256sum -c --quiet "$MANIFEST" 2>/dev/null | sed 's/^/     /' | head -20) || true
    [ "$FORCE" = 1 ] || stop "누가 무엇을 올렸는지 팀에 확인한 뒤, 그 내용이 site/ 에 들어 있으면 --force 로 다시 실행해 주세요."
    say "   --force: 덮어씁니다 (백업은 남김)"
  fi
else
  say "ℹ️  배포 기록이 없어요 (첫 deploy.sh). 이번 배포부터 지문을 남깁니다."
fi

# ---- 2. ?v= 버전
NEW_VER=$(html_ver "$SITE")
[ "$(printf '%s\n' "$NEW_VER" | wc -l)" = 1 ] || stop "site/*.html 의 ?v= 값이 여러 개예요: $(echo $NEW_VER)"
OLD_VER=$(grep -oh '?v=[0-9A-Za-z_-]*' "$DEST/index.html" 2>/dev/null | sort -u | head -1)   # 배포본에만 있는 옛 파일(start-preview.html 등)은 무시
ASSET_CHANGED=0
for f in $(cd "$SITE" && find js css -type f); do
  cmp -s "$SITE/$f" "$DEST/$f" || { ASSET_CHANGED=1; break; }
done
if [ "$ASSET_CHANGED" = 1 ] && [ "$NEW_VER" = "$OLD_VER" ]; then
  stop "JS · CSS 가 바뀌었는데 ?v= 가 배포본과 같아요 ($NEW_VER). site/*.html 의 ?v= 를 새 값으로 올려 주세요."
fi

# ---- 3. 바뀌는 파일 목록
CHANGES=$(cd "$SITE" && find . -type f ! -name '.*' | sort | while read -r f; do
  if [ ! -e "$DEST/$f" ]; then echo "  + ${f#./}"; elif ! cmp -s "$f" "$DEST/$f"; then echo "  ~ ${f#./}"; fi
done)
if [ -z "$CHANGES" ]; then say "✅ 배포본과 site/ 가 같아요. 올릴 것이 없습니다."; exit 0; fi
say "바뀌는 파일 (+ 새 파일, ~ 수정)  ·  버전 ${OLD_VER:-없음} → $NEW_VER"
say "$CHANGES"
[ "$CHECK" = 1 ] && { say "(--check: 배포하지 않음)"; exit 0; }

# ---- 4. 테스트 (그동안 site/ 가 바뀌면 멈춤)
BEFORE=$(hash_dir "$SITE" | sha256sum)
if [ -z "${CHROME_PATH:-}" ] && [ -x /root/pw/chromium-1140/chrome-linux/chrome ]; then
  export CHROME_PATH=/root/pw/chromium-1140/chrome-linux/chrome
  export LD_LIBRARY_PATH=/root/pwlibs/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
fi
say "테스트 실행 중…"
sh "$ROOT/tests/run-all.sh" > "$STATE/last-test.log" 2>&1 || { tail -25 "$STATE/last-test.log"; stop "테스트 실패 — 배포하지 않았어요 (전체 로그: $STATE/last-test.log)"; }
tail -1 "$STATE/last-test.log"
[ "$(hash_dir "$SITE" | sha256sum)" = "$BEFORE" ] || stop "테스트하는 동안 site/ 가 바뀌었어요 (다른 사람이 고치는 중). 끝난 뒤 다시 실행해 주세요."

# ---- 5. 테스트한 그대로 복사본을 만들어 둔다 (복사하는 사이 바뀌어도 섞이지 않게)
mkdir -p "$STAGE"
cp -a "$SITE/." "$STAGE/"
for f in $(cd "$SITE" && find . -type f ! -name '.*'); do
  cmp -s "$SITE/$f" "$STAGE/$f" || stop "복사본이 테스트한 내용과 달라요 ($f). 다시 실행해 주세요."
done

if [ "$YES" != 1 ]; then
  printf '배포할까요? [y/N] '; read -r ans
  [ "$ans" = y ] || [ "$ans" = Y ] || stop "취소했어요."
fi

# ---- 6. 백업 → 복사
BAK="$DEST.bak-$(date +%Y%m%d-%H%M%S)"
cp -a "$DEST" "$BAK"
(cd "$SITE" && find . -type f ! -name '.*') | while read -r f; do
  mkdir -p "$DEST/$(dirname "$f")"
  cp "$STAGE/$f" "$DEST/$f"
done
hash_dir "$DEST" > "$MANIFEST"

CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/wakeup/ || echo 000)
WHO=${SUDO_USER:-${USER:-?}}${SSH_CLIENT:+ ($(echo "$SSH_CLIENT" | cut -d' ' -f1))}
N=$(printf '%s\n' "$CHANGES" | wc -l)
printf '%s\t%s\t%s\t파일 %s개\tHTTP %s\t백업 %s\n' "$(date '+%F %T')" "$WHO" "$NEW_VER" "$N" "$CODE" "$(basename "$BAK")" >> "$LOG"
say "✅ 배포 완료 · $NEW_VER · 파일 ${N}개 · /wakeup/ HTTP $CODE · 백업 $(basename "$BAK")"
say "   기록: $LOG"
NB=$(ls -d "$DEST".bak-* 2>/dev/null | wc -l)
[ "$NB" -le 10 ] || say "ℹ️  백업 폴더가 ${NB}개예요. 오래된 것 정리는 팀에 물어본 뒤 하세요."
