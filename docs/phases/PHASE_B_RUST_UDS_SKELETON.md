# PHASE B — Rust UDS sidecar skeleton

Status: NEXT

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
- Create a new Rust crate (location TBD) with UDS HTTP server
- Implement minimal `/a2a/request` handler:
  - initially proxy to existing HTTP sidecar OR call existing logic via a child-process adapter
  - return structured JSON always

## Non-goals
- No libp2p yet
- No discovery redesign

## Rollback
- Stop Rust daemon and point plugin back to HTTP sidecar.

## Evidence required to mark DONE
- `curl --unix-socket ~/.openclaw/a2a/sidecar.sock http://localhost/healthz` returns ok
- OpenClaw `a2a_request` succeeds via UDS path
- Release gate can run end-to-end using UDS transport

## Notes
- Rust install on this host requires an exec approval path (cannot be approved via WhatsApp).

