# Phase 3 — Session / Probe Runtime (Planning)

## 1. Purpose
Phase 3 (Session / Probe Runtime) defines the **first live interaction context** between two nodes on top of the already-proven transport + protocol runtime baseline.

It is responsible for:
- creating a **live session context** between Node A and Node B
- driving **probe-oriented session progress** (a minimal, observable interaction)
- preparing the boundary for later **Friendship Trigger Layer** integration (later phase; not implemented here)

## 2. Position in System
This phase sits strictly above the proven baseline layers:

**transport**
→ **formal inbound / protocol runtime**
→ **session / probe runtime**
→ **friendship trigger (later)**

Phase 3 must not alter the transport or the frozen protocol/envelope semantics; it only adds the next runtime layer that consumes valid envelopes and advances session state.

## 3. Minimal Goal
The smallest successful Phase 3 outcome is:
- Node A can **initiate** a probe-oriented session with Node B
- Node B can **receive and process** the probe-related session message
- both sides can **observe session state progress**
- **no friendship persistence** yet (no durable relationship artifacts)

## 4. Required Concepts
Minimum concepts needed to implement and test Phase 3:

- **session_id**
  - unique identifier for a single live interaction context
- **peer_actor_id**
  - identifier for the remote participant (peer) in the session
- **local_entered**
  - boolean/flag indicating local node has entered/initialized the session
- **remote_entered**
  - boolean/flag indicating the remote node has entered/acknowledged the session
- **session state**
  - minimal state machine for the session lifecycle (see below)
- **probe progress**
  - minimal progress indicator(s) showing that a probe has advanced

Suggested minimal session state model (non-binding; can be refined without changing frozen layers):
- `NEW` → `LOCAL_ENTERED` → `REMOTE_ENTERED` → `PROBING` → `COMPLETE`

## 5. Minimal Runtime Path
Intended runtime path for Phase 3 (no changes to frozen transport/protocol semantics):

Node A
→ send a **probe-related formal envelope**
→ transport
→ Node B
→ `formalInboundEntry`
→ `protocolProcessor`
→ **session state update** (Phase 3)
→ **machine-safe result**

Notes:
- Phase 3 logic must be downstream of existing validation and processor wiring.
- Invalid input must still be rejected **before** any session/probe processing is invoked.

## 6. Minimal Implementation Order
Implementation order for Phase 3 should be constrained and proof-oriented:

1. **Session/probe message kinds (smallest subset only)**
   - Define the minimal message kinds needed to start and advance a probe session (e.g., `session_probe_init`, `session_probe_ack`, `session_probe_step`).
   - Do not introduce broader capability/task messages.

2. **Session state transition handling**
   - Implement a minimal transition handler that:
     - creates/loads session state by `session_id`
     - updates `local_entered` / `remote_entered`
     - advances `probe progress`
   - Ensure all outputs remain machine-safe.

3. **Local single-machine E2E**
   - Validate that a single node can:
     - accept the probe message via the existing inbound path
     - update session state
     - produce machine-safe results

4. **Two-machine relay E2E**
   - Validate Node A → relay transport → Node B with the same strict boundary:
     - `formalInboundEntry` reached
     - envelope validated
     - `protocolProcessor` invoked for valid envelope
     - session state updated
     - machine-safe result returned
     - invalid inputs fail closed before session logic

5. **Freeze document**
   - After proof, produce a Phase 3 freeze note documenting:
     - minimal message kinds
     - validated state transitions
     - proof boundary and non-goals

## 7. Hard Constraints
Phase 3 must explicitly respect the following constraints:

- **Do not modify frozen transport semantics** (`TRANSPORT_BASELINE_FROZEN`).
- **Do not modify frozen envelope semantics** (validation rules and envelope shape remain unchanged).
- **Fail-closed behavior must remain**: invalid inputs are rejected before processor/session logic.
- **No mailbox** (no offline queue, no store-and-forward).
- **No capability invocation yet** (no capability registry usage, no task execution).
- **No friendship persistence yet** (no durable relationship records, no long-lived trust state).

## 8. Explicit Non-Goals
This phase does NOT include:
- friendship creation
- capability registry
- task invocation
- task result exchange
- mailbox
- queue / retry / backoff
- runtime-wide always-on orchestration

## 9. Success Criteria
Phase 3 is considered successful when:
- the session/probe path runs end-to-end using the existing baseline path
- results are **machine-safe** and suitable for automation
- invalid input is **fail-closed** (rejected before any session/probe processing)
- there are **no friendship side-effects** (no persistence, no trigger layer integration yet)

## 10. Follow-up Phase
Successful completion of Phase 3 enables:
- **Friendship Trigger Layer runtime integration** (next phase), using the now-proven session/probe runtime boundary as the entry point for relationship initiation.
