# PHASE C — libp2p transport substrate + relay fallback

Status: IN_PROGRESS

## Goal
Introduce libp2p as the **network substrate** for the `a2a-sidecar` daemon, while:
- keeping the JSON contract unchanged
- keeping relay fallback available
- staying desktop/server-first (no mobile)

Phase C is intentionally split:
- C1: bring up libp2p node + expose status in `/healthz`
- C2: route a2a requests over libp2p request/response (optional transport)

## Scope (C1)
- Add libp2p dependencies to `rust/a2a-sidecar`
- Start a libp2p node in-process
- Surface `peer_id` + listening addrs in `/healthz` under `p2p`

## Non-goals (C1)
- No request routing over libp2p yet
- No DHT/pubsub discovery yet

## Rollback
- Disable libp2p bring-up:
  - `A2A_LIBP2P_ENABLE=0`

## Evidence required to mark C1 DONE
- `cargo build --release` succeeds
- `/healthz` includes `p2p.peer_id` and at least one `p2p.listening` addr

## Artifacts (C1)
- `checkpoints/phases/PHASE_C/20260322-140345/`
  - `README.md`
  - `summary.json`
  - `evidence/uds_healthz_with_p2p.json`

## Next (C2)
- Implement libp2p request-response protocol for `POST /a2a/request`
- Add transport selection: libp2p first, relay fallback second

