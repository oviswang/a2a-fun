#!/usr/bin/env bash
set -euo pipefail

if [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi

PORT=${PORT:-3000}
RUNTIME_MODE=${RUNTIME_MODE:-formal}

echo "Starting A2A-FUN runtime"
echo "  PORT=$PORT"
echo "  RUNTIME_MODE=$RUNTIME_MODE"
echo "  ENABLE_FORMAL_OUTBOUND=${ENABLE_FORMAL_OUTBOUND:-false}"
echo "  ALLOW_TEST_STUB_OUTBOUND=${ALLOW_TEST_STUB_OUTBOUND:-false}"
echo "  RELAY_URL=${RELAY_URL:-wss://bootstrap.a2a.fun/relay}"

# Bridge defaults (experimental; read-only; never uses main)
echo "  ENABLE_OPENCLAW_LIVE_QUERY_BRIDGE=${ENABLE_OPENCLAW_LIVE_QUERY_BRIDGE:-false}"
echo "  OPENCLAW_LIVE_QUERY_AGENT_ID=${OPENCLAW_LIVE_QUERY_AGENT_ID:-a2a_bridge}"

echo "NOTE: This starter runs a minimal fail-closed node wiring placeholder unless protocol components are wired in." 

node scripts/start-node.mjs
