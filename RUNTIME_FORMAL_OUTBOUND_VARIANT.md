# Runtime Formal Outbound Variant (Phase 7 Integration)

This note clarifies the intent and safety boundaries of the formal outbound runtime integration.

## Positioning

- `startRuntimeNodeFormal(...)` is **only** a runtime wiring variant that integrates the Phase 7 formal outbound builder.
- It is **not** a replacement for the frozen Phase 6 runtime (`startRuntimeNode(...)`).
- It is **not** a new protocol phase.
- The frozen Phase 6 runtime remains the baseline; this variant is additive for environments that explicitly want Phase 7 formal egress.

## Safety boundary: formalOutboundUrl

- `formalOutboundUrl` must be an explicitly configured **trusted peer endpoint**.
- The runtime does **not** do dynamic discovery.
- The runtime must **not** derive the formal outbound URL from inbound messages.

## Priority rule

If both are enabled:
- Formal outbound (`enableFormalOutbound=true`) MUST take priority.
- TEST_STUB_OUTBOUND must NOT be sent in that case.
