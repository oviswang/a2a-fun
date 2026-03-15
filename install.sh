#!/usr/bin/env bash
set -euo pipefail

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need_cmd git
need_cmd node
need_cmd npm

node_major=$(node -p "process.versions.node.split('.')[0]")
if [ "$node_major" -lt 18 ]; then
  echo "Node.js >= 18 required (found $(node -v))" >&2
  exit 1
fi

echo "Installing npm dependencies..."
npm install

mkdir -p data

if [ ! -f .env ]; then
  echo "Creating .env from .env.example (no overwrite)"
  cp .env.example .env
else
  echo ".env already exists; not overwriting"
fi

echo "Pre-initializing OpenClaw bridge agent (a2a_bridge)..."
if command -v openclaw >/dev/null 2>&1; then
  # Optional: create agent if missing (minimal, expected OpenClaw behavior).
  if ! openclaw agents list 2>/dev/null | grep -q "^- a2a_bridge"; then
    echo "Creating OpenClaw agent: a2a_bridge"
    openclaw agents add a2a_bridge --non-interactive --workspace "$PWD" --model openai/gpt-5.2 >/dev/null
  fi

  # Pre-init session (text-only).
  node scripts/openclaw_preinit_a2a_bridge.mjs >/dev/null || true
else
  echo "openclaw CLI not found; skipping a2a_bridge preinit" >&2
fi

echo "Install complete."
