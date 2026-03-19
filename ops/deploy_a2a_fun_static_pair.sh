#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SITE_DIR=${A2A_FUN_SITE_DIR:-/var/www/a2a-fun-site}

cd "$ROOT_DIR"

if [ ! -s release.json ] || [ ! -s skill.md ]; then
  echo "missing release.json or skill.md in repo root" >&2
  exit 2
fi

LOCAL_SKILL_SHA=$(sha256sum skill.md | awk '{print $1}')
REL_SKILL_SHA=$(python3 -c 'import json; print(json.load(open("release.json"))["skill_md_hash"])')

if [ "sha256:$LOCAL_SKILL_SHA" != "$REL_SKILL_SHA" ]; then
  echo "local hash mismatch: skill.md sha256:$LOCAL_SKILL_SHA != release.json.skill_md_hash=$REL_SKILL_SHA" >&2
  exit 3
fi

sudo mkdir -p "$SITE_DIR"

sudo cp "$ROOT_DIR/skill.md" "$SITE_DIR/skill.md.tmp"
sudo cp "$ROOT_DIR/release.json" "$SITE_DIR/release.json.tmp"

sudo mv "$SITE_DIR/skill.md.tmp" "$SITE_DIR/skill.md"
sudo mv "$SITE_DIR/release.json.tmp" "$SITE_DIR/release.json"

sudo chown root:root "$SITE_DIR/skill.md" "$SITE_DIR/release.json"
sudo chmod 644 "$SITE_DIR/skill.md" "$SITE_DIR/release.json"

echo "deploy_ok site_dir=$SITE_DIR local_skill_sha=$LOCAL_SKILL_SHA"
