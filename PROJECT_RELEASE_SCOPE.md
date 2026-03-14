# Agent Social & Capability Protocol Baseline — Release Scope v0.1

Status: RELEASE SCOPE (documentation-only)

This document defines the exact scope of the current project release.

It describes what the system **already implements and proves**, and what is **explicitly outside the scope** of this release.

No runtime behavior or protocol semantics may be changed by this document.

---

# 1. Overview

This project implements a deterministic, machine-safe baseline protocol for agent-to-agent interaction.

The baseline includes:

peer discovery  
conversation initiation  
friendship establishment  
friendship-gated capability sharing  
capability invocation artifacts  

The system emphasizes:

deterministic outputs  
bounded machine-safe artifacts  
explicit gating rules  
fail-closed validation behavior  

This release focuses on protocol correctness rather than execution runtime.

---

# 2. Implemented Layers

The following layers are implemented and frozen.

## Network Baseline
Relay transport path validated across two-machine runtime.

## Protocol Runtime Baseline
Formal inbound processing entrypoint with deterministic envelope validation.

## Phase3 Session / Probe Runtime
Session probe initialization and state transitions.

Validated states:
NEW → LOCAL_ENTERED

Probe messages verified through runtime processing.

## Friendship Trigger Layer
Conversation or discovery can trigger the friendship establishment process.

Friendship creation remains gated by Phase3 rules.

Outputs machine-safe:

friendship_record


## Discovery Layer
Agent discovery interaction primitives.

Outputs deterministic discovery interaction objects.

## Conversation Runtime Layer
Minimal conversation artifacts:

opening message  
conversation turn  
conversation transcript  
conversation surface  
conversation → friendship handoff

Conversation artifacts are bounded and deterministic.


## Capability Sharing Layer

Implements friendship-gated capability exchange primitives:

capability advertisement  
capability discovery  
invocation-ready capability reference

Capabilities can only be shared inside a valid friendship context.


## Capability Invocation Layer

Implements invocation artifacts:

capability invocation request  
capability invocation result (success/failure)

Invocation artifacts bind to:

capability_ref_id  
friendship_id  
capability_id

Execution runtime is not included.

---

# 3. Proven Runtime Paths

The following runtime paths have been validated.

### Conversation → Friendship

conversation surface  
→ HANDOFF_TO_FRIENDSHIP  
→ Phase3 probe init  
→ inbound runtime processing  
→ LOCAL_ENTERED state

Friendship candidate remains gated until Phase3 requirements are satisfied.


### Capability Sharing Runtime

friendship_record  
→ capability advertisement  
→ capability discovery  
→ capability reference


### Capability Invocation Artifact Runtime

capability_reference  
→ invocation request  
→ invocation result (success/failure)

---

# 4. Safety Guarantees

The system enforces:

deterministic outputs  
bounded artifact shapes  
machine-safe object structures  
friendship-gated capability access  
fail-closed validation behavior  

Invalid inputs do not produce partial artifacts.

---

# 5. Explicitly Not Implemented

The following systems are intentionally **not part of this release**:

real capability execution runtime  
remote execution sandbox  
result transport / return protocol  
mailbox systems  
task orchestration  
queue / scheduling  
retry / backoff  
multi-agent planning  
capability marketplaces  
pricing or economic models  

---

# 6. Architectural Boundaries

This release preserves strict boundaries.

Transport semantics remain unchanged.

Protocol envelope semantics remain unchanged.

Phase3 session rules remain unchanged.

Friendship Trigger semantics remain unchanged.

Discovery semantics remain unchanged.

Conversation semantics remain unchanged.

Capability Sharing semantics remain unchanged.

Capability Invocation produces invocation artifacts only and does not execute tasks.

---

# 7. Current System Identity

The current system should be described as:

Agent Social & Capability Protocol Baseline v0.1


It provides:

a deterministic agent interaction protocol  
friendship-gated capability sharing  
invocation artifact preparation  


It does not yet implement:

remote execution runtime  
task orchestration  
agent marketplaces
