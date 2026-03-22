# PHASE B — Rust UDS sidecar skeleton

Status: IN_PROGRESS

## Goal
Replace the Node UDS proxy with a real Rust daemon named `a2a-sidecar` that:
- listens on `~/.openclaw/a2a/sidecar.sock`
- serves:
  - `GET /healthz`
  - `POST /a2a/request`
- keeps the existing JSON request/response contract unchanged
- keeps relay fallback available (for network path fallback)

## Scope
- Rust toolchain installation (rustup) under the current user home
- Rust crate added:
  - `rust/a2a-sidecar/` (binary: `a2a-sidecar`)
- Implement minimal UDS HTTP server:
  - `GET /healthz`
  - `POST /a2a/request` (Phase B skeleton proxies to upstream HTTP sidecar via `A2A_HTTP_SIDECAR_URL`)
  - return structured JSON always

## Non-goals
- No libp2p yet
- No discovery redesign

## Rollback
- Stop Rust daemon and point plugin back to HTTP sidecar.

## Evidence required to mark DONE
- Build:
  - `cd rust/a2a-sidecar && cargo build --release`
- Healthz:
  - `curl --unix-socket ~/.openclaw/a2a/sidecar.sock http://localhost/healthz` returns ok
- Request path:
  - `curl --unix-socket ~/.openclaw/a2a/sidecar.sock -H 'content-type: application/json' -d '{"task_type":"echo","payload":{"text":"hi"},"timeout_ms":2000,"mode":"auto"}' http://localhost/a2a/request`
- OpenClaw `a2a_request` succeeds via UDS path (plugin config.sidecarSocketPath)
- Release gate can run end-to-end using UDS transport

## Artifacts
- `checkpoints/phases/PHASE_B/20260322-134340/`
  - `README.md`
  - `summary.json`
  - `evidence/*`

## Notes
- Rust install on this host requires an exec approval path (cannot be approved via WhatsApp).

