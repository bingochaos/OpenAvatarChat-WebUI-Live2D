#!/usr/bin/env bash
# Download Cubism sample models from the official Live2D repo into
# src/renderer/public/live2d/<id>/ and regenerate the front-end manifest
# (models.json) with every model that was downloaded successfully AND is
# compatible with the bundled Cubism core (see MAX_MOC_VERSION below).
# Models whose moc3 header advertises a newer version (currently Ren,
# moc3 v6, which requires Cubism 5.x newer-than-shipped) are dropped
# from the manifest to avoid a runtime "unsupported moc3 version" crash.
#
# Upstream:
#   https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources
#
# The script does a shallow, sparse, blob-less git clone of the upstream
# repository into a temp dir, then copies each requested model folder into
# the target directory. This avoids per-file raw.githubusercontent.com
# downloads, which are frequently blocked or throttled.
#
# Usage:
#   scripts/download-live2d-models.sh                 # download all
#   scripts/download-live2d-models.sh Haru Wanko      # only specific models
#
# Tuning via env vars:
#   CLONE_URL=https://github.com/Live2D/CubismWebSamples.git   # override remote
#   REF=develop                                                # override branch/tag
#   TARGET_DIR=<path>                                          # override target
#   MAX_MOC_VERSION=4                                          # max moc3 version to keep
#   LOG_FILE=/tmp/live2d.log                                   # tee all output here
#
# Proxy (optional, only if direct GitHub access fails):
#   export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890
#
# Requires: bash, git, python3, rsync (optional; falls back to cp).

set -euo pipefail

REPO_URL_DEFAULT="https://github.com/Live2D/CubismWebSamples.git"
CLONE_URL="${CLONE_URL:-$REPO_URL_DEFAULT}"
REF="${REF:-develop}"
RESOURCE_PREFIX="Samples/Resources"
# The live2dcubismcore.min.js shipped alongside the renderer loads moc3
# versions up through Cubism 5.0 (moc3 v5, e.g. the Mao sample). Ren on
# CubismWebSamples@develop is moc3 v6 and still fails to load, so it is
# dropped from the manifest until the core is upgraded.
MAX_MOC_VERSION="${MAX_MOC_VERSION:-5}"

ALL_MODELS=(Haru Hiyori Mao Mark Natori Ren Rice Wanko)
LABELS_JSON='{
  "Haru": "Haru",
  "Hiyori": "Hiyori (桃瀬ひより)",
  "Mao": "Mao",
  "Mark": "Mark",
  "Natori": "Natori",
  "Ren": "Ren",
  "Rice": "Rice",
  "Wanko": "Wanko (わんこ)"
}'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="${TARGET_DIR:-$REPO_ROOT/src/renderer/public/live2d}"
MANIFEST="$TARGET_DIR/models.json"
LOG_FILE="${LOG_FILE:-}"

if [ -n "$LOG_FILE" ]; then
  : > "$LOG_FILE"
  exec > >(tee -a "$LOG_FILE") 2>&1
  echo "==> Logging to $LOG_FILE"
fi

log() { echo "[$(date +%H:%M:%S)] $*"; }

human_bytes() {
  awk -v b="${1:-0}" 'BEGIN{
    split("B KB MB GB",u);s=1;
    while(b>=1024 && s<4){b/=1024;s++}
    printf("%.1f%s",b,u[s])
  }'
}

# Read byte 4 of a .moc3 file (moc3 header: "MOC3" + <version byte>).
# Echoes an integer or "?" if the file is unreadable / too short.
moc3_version() {
  python3 - "$1" <<'PY'
import sys
try:
    with open(sys.argv[1], "rb") as f:
        head = f.read(8)
    if len(head) < 5 or head[:4] != b"MOC3":
        print("?")
    else:
        print(head[4])
except Exception:
    print("?")
PY
}

if [ "$#" -gt 0 ]; then
  WANT_MODELS=("$@")
else
  WANT_MODELS=("${ALL_MODELS[@]}")
fi

command -v git >/dev/null 2>&1 || { log "ERROR: git not found"; exit 1; }
command -v python3 >/dev/null 2>&1 || { log "ERROR: python3 not found"; exit 1; }

mkdir -p "$TARGET_DIR"
CLONE_TMP="$(mktemp -d)"
trap 'rm -rf "$CLONE_TMP"' EXIT

log "==> Cloning $CLONE_URL (branch=$REF, sparse, blob-less)"
log "    tmp:             $CLONE_TMP"
log "    target:          $TARGET_DIR"
log "    models:          ${WANT_MODELS[*]}"
log "    max moc version: $MAX_MOC_VERSION"

clone_start=$(date +%s)
GIT_TERMINAL_PROMPT=0 git \
  -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 \
  clone --depth 1 --filter=blob:none --sparse \
  --branch "$REF" "$CLONE_URL" "$CLONE_TMP" 2>&1 | sed 's/^/    git: /'
log "    clone done in $(( $(date +%s) - clone_start ))s"

( cd "$CLONE_TMP" && git sparse-checkout set "$RESOURCE_PREFIX" && git checkout ) \
  2>&1 | sed 's/^/    git: /'

ok_models=() bad_models=() incompat_models=()
for m in "${WANT_MODELS[@]}"; do
  src="$CLONE_TMP/$RESOURCE_PREFIX/$m"
  id="$(echo "$m" | tr '[:upper:]' '[:lower:]')"
  dst="$TARGET_DIR/$id"
  if [ ! -d "$src" ]; then
    log "   !! $m: not present in upstream (skipped)"
    bad_models+=("$m")
    continue
  fi
  rm -rf "$dst"
  mkdir -p "$dst"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude 'sounds/' --exclude 'sounds/**' "$src/" "$dst/"
  else
    cp -r "$src/." "$dst/"
    rm -rf "$dst/sounds" 2>/dev/null || true
  fi

  moc3_path="$dst/$m.moc3"
  if [ ! -f "$moc3_path" ]; then
    log "   !! $m: missing $m.moc3 after copy (skipped)"
    rm -rf "$dst"
    bad_models+=("$m")
    continue
  fi
  ver="$(moc3_version "$moc3_path")"
  if [ "$ver" = "?" ]; then
    log "   !! $m: cannot read moc3 header (skipped)"
    rm -rf "$dst"
    bad_models+=("$m")
    continue
  fi
  if [ "$ver" -gt "$MAX_MOC_VERSION" ]; then
    log "   -- $m: moc3 v$ver > MAX_MOC_VERSION=$MAX_MOC_VERSION (incompatible with current SDK, dropped)"
    rm -rf "$dst"
    incompat_models+=("$m(v$ver)")
    continue
  fi

  bytes=$(du -sb "$dst" 2>/dev/null | awk '{print $1}')
  log "   ok $m (moc3 v$ver) -> $dst ($(human_bytes "${bytes:-0}"))"
  ok_models+=("$m")
done

log "==> Summary: ok=${#ok_models[@]} fail=${#bad_models[@]} incompat=${#incompat_models[@]}"
[ "${#ok_models[@]}" -gt 0 ]       && log "    ok:       ${ok_models[*]}"
[ "${#bad_models[@]}" -gt 0 ]      && log "    fail:     ${bad_models[*]}"
[ "${#incompat_models[@]}" -gt 0 ] && log "    incompat: ${incompat_models[*]}"

log "==> Regenerating $MANIFEST"
OK="${ok_models[*]}" TARGET_DIR="$TARGET_DIR" LABELS_JSON="$LABELS_JSON" python3 - <<'PY'
import json, os
target_dir = os.environ["TARGET_DIR"]
ok_models = os.environ["OK"].split()
labels = json.loads(os.environ["LABELS_JSON"])
entries = []
for name in ok_models:
    idv = name.lower()
    model_json = os.path.join(target_dir, idv, f"{name}.model3.json")
    moc = os.path.join(target_dir, idv, f"{name}.moc3")
    if not (os.path.isfile(model_json) and os.path.isfile(moc)):
        continue
    entries.append({
        "id": idv,
        "label": labels.get(name, name),
        "path": f"./live2d/{idv}/{name}.model3.json",
    })
manifest_path = os.path.join(target_dir, "models.json")
with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump({
        "$comment": "Auto-generated by scripts/download-live2d-models.sh. Only models that downloaded successfully and whose moc3 version is compatible with the current Cubism core (<= MAX_MOC_VERSION) are listed here. Re-running the downloader will regenerate this file.",
        "models": entries,
    }, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"   wrote {len(entries)} model entries")
PY

log "==> Done."
