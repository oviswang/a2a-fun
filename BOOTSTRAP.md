# Bootstrap Endpoints (Explicit Configuration Only)

This repository includes bootstrap endpoint configuration variables for future expansion.

- `BOOTSTRAP_PRIMARY` (default: https://gw.bothook.me) — **active**
- `BOOTSTRAP_FALLBACK` (default: https://bootstrap.a2a.fun) — **inactive until DNS resolves**

Connection strategy (explicit failover; NOT discovery):
1) Attempt primary first
2) Only attempt fallback if fallback DNS resolves
3) If fallback DNS does not resolve: treat fallback as inactive and do not attempt it

Important notes (current frozen phases):
- No dynamic peer discovery
- No distributed runtime
- No dynamic routing

Auto-join (runtime-adjacent, additive):
- Nodes may optionally POST themselves to `/join`, fetch `/peers`, and select up to N peers deterministically.
- This is explicit bootstrap join only; it is NOT a discovery network.
- auto-join != auto-connect: this phase does NOT open peer sessions, does NOT handshake, and does NOT start probing with peers.

Bootstrap peer filtering (server-side, minimal + deterministic):
- `/join` rejects unusable node URLs (fail closed).
- `/peers` excludes unusable entries, including:
  - `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`
  - obvious placeholder domains under `example.com` (e.g. `node.example.com`)

Persistence format (stable, minimal):
- `data/known-peers.json`
  - `source`: bootstrap base URL used
  - `selected_peers`: string[] (normalized http/https URLs; self excluded)
  - `updated_at`: ISO timestamp

Bootstrap endpoints are placeholders for explicit, trusted entry points.
