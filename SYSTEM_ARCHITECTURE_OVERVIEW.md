# System Architecture Overview

Status: architecture overview (documentation-only)

This document explains the current architecture of the Agent Social & Capability Protocol Baseline v0.1.

It is intended to show:

system layers  
runtime paths  
gating rules  
frozen boundaries  
current release scope

---

# 1. Top-Level Architecture

The system is implemented as a strict layered architecture:

Transport Layer  
Protocol Runtime Layer  
Phase3 Session / Probe Layer  
Friendship Trigger Layer  
Discovery Layer  
Conversation Runtime Layer  
Capability Sharing Layer  
Capability Invocation Layer  

Each higher layer depends on lower validated layers.

Higher layers compose on top of lower layers but do not change lower-layer semantics.

---

# 2. Layer Responsibilities

## Transport Layer
Relay transport / delivery boundary.

## Protocol Runtime Layer
Formal inbound processing, validation, deterministic machine-safe processing.

## Phase3 Session / Probe Layer
Probe initiation and state progress.

## Friendship Trigger Layer
Gated friendship establishment.

## Discovery Layer
Discovery candidates, compatibility, preview, interaction, handoff.

## Conversation Runtime Layer
Opening message, turn, transcript, conversation surface, friendship handoff.

## Capability Sharing Layer
Advertisement, discovery, capability references.

## Capability Invocation Layer
Invocation request and result artifacts.

---

# 3. Main Runtime Paths

## Discovery → Friendship
known peers  
→ discovery  
→ interaction  
→ handoff  
→ Phase3 probe init  
→ friendship gate

## Conversation → Friendship
conversation surface  
→ handoff  
→ Phase3 probe init  
→ friendship gate

## Friendship → Capability Sharing
friendship_record  
→ capability advertisement  
→ capability discovery  
→ capability reference

## Capability Reference → Invocation Artifacts
capability_reference  
→ invocation_request  
→ invocation_result

---

# 4. Gating Rules

Core gating rules:

friendship is gated by Phase3 progress  
capabilities are gated by friendship  
invocation is gated by capability_reference  
conversation/discovery do not create friendship directly  

---

# 5. Safety Model

The current safety model emphasizes:

deterministic outputs  
bounded artifact sizes  
machine-safe object shapes  
explicit validation  
fail-closed behavior  

Invalid inputs do not create partial downstream artifacts.

---

# 6. Frozen Boundaries

The following layers are frozen for v0.1:

Transport baseline  
Protocol runtime baseline  
Phase3 session/probe semantics  
Friendship Trigger semantics  
Discovery semantics  
Conversation Runtime semantics  
Capability Sharing semantics  
Capability Invocation semantics  

"Frozen" means:

semantics fixed  
behavior intentionally bounded  
future work must layer above or beside, not silently mutate frozen rules

---

# 7. Current Release Boundary

v0.1 includes:

social protocol baseline  
friendship-gated capability sharing  
invocation artifacts  

v0.1 excludes:

real execution runtime  
orchestration  
mailbox  
marketplace / pricing  
scheduling / queueing  

---

# 8. Next Logical Expansion

Next likely directions:

remote execution runtime  
result return path  
task cooperation  
or richer agent/human mixed conversation
