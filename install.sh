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

echo "Install complete."
