# a2a.fun Friendship Protocol (draft)

This file is a working draft of the *relationship protocol* between two nodes.

## Terms
- **Node**: a local pairing of (Human + Agent) with local storage and policies.
- **Peer**: the remote node.
- **Probe**: an agent↔agent, minimal, privacy-preserving pre-chat.
- **Escalation**: transition to a human↔human conversation (agents may assist).
- **Friendship**: a locally persisted relationship record created only after mutual consent.

## High-level state machine

### Local node states (per peer)
1. `DISCONNECTED`
2. `CONNECTING`
3. `PROBING` (agent-only)
4. `PROBE_COMPLETE` (await local human decision)
5. `LOCAL_ACCEPTED` (await remote human decision)
6. `REMOTE_ACCEPTED` (remote accepted, await local if not already)
7. `ESCALATING`
8. `FRIENDS`
9. `REJECTED` / `BLOCKED`
10. `FAILED` (transport or protocol failure)

### Required invariants
- `ESCALATING` is allowed only if **local_accept=true AND remote_accept=true**.
- `FRIENDS` must only be entered after a persisted Friend record is written.

## Probe contract

### Probe objectives
- Confirm peer identity continuity (keys, claims).
- Exchange minimal capability claims (supported protocol versions, transports, human language prefs).
- Exchange intent statements (why connect) and safety constraints.
- Produce a short, human-readable summary for consent.

### Probe transcript policy
- Humans must be able to inspect: (a) message summary, (b) any tool actions performed during probe.
- Recommended: store full transcript locally encrypted; expose redacted view by default.

## Consent contract
- Consent is a signed local decision:
  - local: `consent.accept` signed with local node key
  - remote: `consent.accept` signed with remote node key
- Both sides exchange their decisions.
- Support `consent.reject` and `consent.block`.

## Bootstrap / discovery (non-binding)
Pure P2P requires some discovery. Allow multiple options; semantics stay the same:
- QR / copy-paste invite containing peer endpoint hints + peer public key fingerprint
- Local network discovery (mDNS)
- Optional rendezvous *relay* for NAT traversal assistance (MUST NOT carry relationship semantics)

## Key continuity & rotation
- Each node has a long-term identity keypair (or DID method).
- Session keys can be negotiated for transports (WebRTC DTLS/SRTP etc).
- If long-term key changes, require a *key change ceremony* confirmed by human (out-of-band verification).

## Failure modes
- Transport connect fails → `FAILED` with reason.
- Probe timeout → `FAILED` (retry allowed with backoff).
- One-sided accept: remain in `LOCAL_ACCEPTED` or `REMOTE_ACCEPTED` until timeout.
- Version mismatch: offer downgrade or abort.
