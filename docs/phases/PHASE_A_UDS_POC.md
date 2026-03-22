# PHASE A — UDS Integration PoC (Node proxy + OpenClaw plugin)

Status: DONE (PoC)

## Goal
Prove that A2A sidecar can be accessed via **Unix domain socket** inside OpenClaw, with:
- `GET /healthz`
- `POST /a2a/request` (same JSON contract)

Target platforms: desktop + server only (no mobile).
Relay fallback: must remain available.

## Deliverables
- UDS proxy server (PoC): `src/sidecar/a2a_sidecar_uds_proxy.mjs`
- OpenClaw plugin UDS client support: `extensions/a2a-request/index.mjs`

## Decisions
- Socket path (owner): `~/.openclaw/a2a/sidecar.sock`
- Binary name (future Rust): `a2a-sidecar`

## How it works (PoC)
- A2A UDS proxy listens on the socket and forwards requests to an upstream HTTP sidecar.

Env:
- `A2A_SOCK=/home/ubuntu/.openclaw/a2a/sidecar.sock`
- `A2A_HTTP_SIDECAR_URL=http://127.0.0.1:17890`

## Evidence
- UDS proxy emits:
  - `A2A_UDS_LISTENING { sock, upstream }`
- OpenClaw plugin reads:
  - `plugins.entries.a2a-request.config.sidecarSocketPath`

Commits:
- OpenClaw plugin UDS support (workspace repo): `355bc36`

## Rollback
- Unset `sidecarSocketPath` plugin config → plugin falls back to HTTP sidecar URL.

## Limitations
- This is a Node proxy PoC, not the final Rust daemon.
- Rust toolchain not installed yet on the host at time of PoC.

