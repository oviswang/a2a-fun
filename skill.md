# A2A-FUN Node Skill (Install + Run)

## What this skill does

Installs and starts a minimal A2A-FUN node from source.

This repository is a **baseline A2A protocol stack implementation**:
- strict validation + fail-closed protocol core
- session state machine
- deterministic probe engine
- peer key binding subset
- friendship persistence side-effect layer
- minimal HTTP runtime
- formal outbound envelope builder

It is **not** a full network system (no discovery/mesh/distributed runtime).

## Requirements

- Linux/macOS (recommended)
- `git`
- Node.js >= 18
- `npm`

## Install steps

```bash
git clone <REPO_URL>
cd a2a-fun
npm install
cp .env.example .env
./install.sh
```

Notes:
- `install.sh` will NOT overwrite an existing `.env`.
- Do not commit secrets.

## Start steps

Default port: **3000**

```bash
./start-node.sh
```

Environment variables (see `.env.example`):
- `PORT`
- `RUNTIME_MODE` (default: `formal`)
- `ENABLE_FORMAL_OUTBOUND` (default: false)
- `ALLOW_TEST_STUB_OUTBOUND` (default: false)
- `FORMAL_OUTBOUND_URL` (required only if enabling formal outbound send)

Auto-join (explicit bootstrap join; NOT discovery):
- `ENABLE_AUTO_JOIN` (default: false)
- `MAX_BOOTSTRAP_PEERS` (default: 3; range 1..3)
- `SELF_NODE_URL` (required if enabling auto-join; missing/invalid must fail closed; no guessing)

Clarification:
- auto-join != auto-connect: this phase does NOT open peer sessions, does NOT handshake, and does NOT start probing with peers.

## Bootstrap connection

Bootstrap endpoints are explicit trusted entry points (placeholders for future expansion):

- Primary: `BOOTSTRAP_PRIMARY=https://gw.bothook.me`
- Fallback: `BOOTSTRAP_FALLBACK=https://bootstrap.a2a.fun`

Strategy:
- Attempt primary first
- If unreachable, attempt fallback

Important:
- Current phases do NOT implement dynamic peer discovery, routing, or mesh networking.
- Bootstrap endpoints are configuration placeholders; runtime wiring for discovery is intentionally unimplemented.

## Verification

Run unit tests:

```bash
npm test
```

Then confirm the HTTP runtime is listening:

```bash
curl -s -X POST http://127.0.0.1:3000/message -H 'Content-Type: application/json' -d '{"envelope":{}}'
```

Expected behavior in the minimal starter:
- fail-closed response (runtime starter does not ship a full crypto wiring by default)

## Safety notes

- All core validation is fail-closed; unknown/invalid inputs throw.
- Local events must remain separate from remote protocol messages.
- Friendship persistence must remain a side-effect layer (never inside SessionManager/protocolProcessor).
- TEST_STUB_OUTBOUND must not be treated as formal protocol output.
- Frozen phases must not drift without explicit approval.
