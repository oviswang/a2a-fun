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

Bootstrap endpoints are placeholders for explicit, trusted entry points.
