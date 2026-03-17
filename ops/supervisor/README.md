# NODE_SUPERVISOR_LAYER_V1

## Responsibility Boundary

### External supervisor (systemd or watchdog)
Responsible for:
- detecting daemon process missing
- starting/restarting daemon

### Internal auto-recovery (in-daemon)
Responsible for:
- plugin missing/not loaded (safe resync + gateway restart)
- gateway route unavailable (safe restart + retest)
- in-process safe recovery only

**Non-goals (must NOT be automated):**
- WhatsApp relogin/relink
- changing delivery targets
- deleting `data/`
- changing node identity

## Preferred start guidance

1) If systemd is available: install `ops/systemd/a2a-fun-daemon.service` (Restart=always, RestartSec=3)
2) Otherwise: run `node scripts/supervisor_watchdog.mjs` (checks every 30–60s)

Do not rely on in-daemon recovery to resurrect the daemon if the daemon process is dead.
