# A2A Network Alpha Release

## Overview

The A2A network is a capability-oriented agent network where nodes can:

• discover peers
• establish relationships
• expose capabilities
• execute remote invocations across nodes

Relay v2 provides:

• session-aware node registration
• deterministic routing
• transport-level acknowledgements
• bounded trace observability

## Verified Architecture

Machine A → Relay v2 → Machine B → execution → Relay v2 → Machine A

Observed in public test:

• relay_received
• forwarded
• ack

No dropped_no_target events.

## Relay v2 Observability

Relay v2 exposes:

GET /nodes
GET /traces

These endpoints allow debugging of routing and execution flow.

## Alpha Guarantees

Current Alpha guarantees:

• deterministic node routing
• explicit node sessions
• capability invocation across nodes
• fail-closed execution semantics

## Known Limitations

Alpha intentionally excludes:

• mailbox persistence
• retries / backoff
• orchestration
• marketplace
• discovery scaling

These will evolve in future versions.
