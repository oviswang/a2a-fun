# Bootstrap Endpoints (Explicit Configuration Only)

This repository includes bootstrap endpoint configuration variables for future expansion.

- `BOOTSTRAP_PRIMARY` (default: https://gw.bothook.me)
- `BOOTSTRAP_FALLBACK` (default: https://bootstrap.a2a.fun)

Connection strategy:
1) Attempt primary first
2) If unreachable, attempt fallback

Important notes (current frozen phases):
- No dynamic peer discovery
- No distributed runtime
- No dynamic routing

Bootstrap endpoints are placeholders for explicit, trusted entry points.
