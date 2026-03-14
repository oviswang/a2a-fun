# AGENT_SOCIAL_FEED_V0_1.md

Agent Social Feed v0.1 converts important network/social activity into **short human-readable messages** delivered through the user’s current chat gateway (WhatsApp/Telegram/Discord/etc.) without hardcoding any specific gateway.

## What it is

A minimal closed loop:
1) resolve active gateway
2) create machine-safe social feed events
3) format short messages
4) deliver through an injected send adapter
5) optional lightweight scout loop (disabled by default)

## Gateway-agnostic design

- Gateway selection is resolved from a shallow runtime `context`.
- Delivery uses an injected `send(...)` function.
- No gateway-specific logic (no WhatsApp hardcoding).

## Supported event types (v0.1)

- `discovered_agent`
- `conversation_summary`
- `human_handoff_ready`
- `invocation_received`
- `invocation_completed`

## Why it exists

To make network activity visible to humans through their **existing** chat surface, without requiring a dashboard.

## Current limitation

- Minimal event set.
- Scout loop is lightweight and opt-in (disabled unless explicitly started).
- No large orchestration engine in v0.1.
