# Node Auto-Join Bootstrap Flow — Frozen Record

Frozen on: 2026-03-13 (Asia/Shanghai)

Node Auto-Join Flow is **FROZEN**.
Behavior must remain stable unless fixing a **critical bug**.

## 1) Implemented components

- bootstrapClient
  - Module: `src/runtime/bootstrap/bootstrapClient.mjs`
  - `bootstrapJoin(...)` (POST /join)
  - `bootstrapGetPeers(...)` (GET /peers)
  - strict URL + peers list validation (fail closed)

- nodeAutoJoin
  - Module: `src/runtime/bootstrap/nodeAutoJoin.mjs`
  - `runNodeAutoJoin(...)` orchestrates join → peers fetch → select → persist

- Startup-time optional auto-join wiring
  - Module: `scripts/start-node.mjs`
  - Enabled only via explicit env `ENABLE_AUTO_JOIN=true`

- Primary/fallback bootstrap handling
  - Try primary first
  - Fallback only when primary is unreachable (network/DNS/timeout)

- Deterministic peer selection
  - normalize URLs (http/https only; no credentials/fragment; drop search)
  - exclude self
  - de-duplicate exact URLs
  - sort lexicographically
  - select up to `maxPeers` (hard limit 1..3)

- known-peers persistence
  - Atomic write to `data/known-peers.json` (or optional injected storage)

## 2) Hard rules

- `ENABLE_AUTO_JOIN` must be explicit
- If `ENABLE_AUTO_JOIN=true` and `SELF_NODE_URL` is missing or invalid -> **fail closed**
  - Do NOT guess the node URL

- Primary unreachable -> fallback allowed
- Primary reachable but business failure -> must NOT fallback

- auto-join != auto-connect
  - This phase does NOT auto-establish peer sessions
  - This phase does NOT handshake
  - This phase does NOT start probing with peers

## 3) Persistence format

Fixed structure of `data/known-peers.json`:

```json
{
  "source": "<bootstrap base url used>",
  "selected_peers": ["https://.../", "https://.../"],
  "updated_at": "2026-03-13T00:00:00.000Z"
}
```

Notes:
- `selected_peers` are normalized http/https URLs, self excluded, de-duplicated, sorted.

## 4) Explicitly NOT implemented

- dynamic discovery
- mesh/swarm/distributed runtime
- retry/backoff
- auto-handshake
- auto-probe
- automatic peer session establishment

## 5) Hard separation boundaries

- auto-join MUST NOT modify frozen protocol behavior
- auto-join MUST NOT write friendship state
- auto-join MUST NOT establish protocol sessions automatically
