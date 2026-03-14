# AI Skill Protocol v1

## 1. Purpose

AI Skill Protocol v1 exists so AI agents can:
- read a skill file
- execute it step by step
- verify success
- stop safely on failure

## 2. Core Principles

- Sequential execution (step order is authoritative)
- Explicit commands (no implied steps)
- Explicit verification (success must be checked)
- Deterministic behavior (same inputs → same actions)
- Fail-closed execution (stop on verification failure)

## 3. Required Top-Level Fields

A skill file must provide these minimal top-level protocol fields (human-readable, but stable):

- `TYPE`: what kind of skill this is (e.g. `install`, `ops`, `demo`)
- `TARGET`: what system/component it affects (e.g. `a2a-fun-node`, `bootstrap-directory`)
- `MODE`: execution style (e.g. `agent-executable`)
- `STOP_RULE`: failure policy (e.g. `stop_on_verify_fail`)

## 4. Variable Sections

Skill files must separate variables into:

- `FIXED`: constants the agent must not change
- `DYNAMIC`: values the agent resolves on the machine at runtime

Rules:
- FIXED values are constants.
- DYNAMIC values are machine-resolved at runtime.
- Agents must not invent missing values if the protocol already defines them.

## 5. Step Format

Each step must use the following structure exactly:

- `STEP:`
- `RUN:`
- `VERIFY:`
- `ON FAILURE:`
- `NEXT:`

Meaning:
- STEP: step identifier (unique in file; execution order is the order in the document)
- RUN: the commands to execute
- VERIFY: deterministic check(s) that must pass before proceeding
- ON FAILURE: what to do if VERIFY fails (retry/stop/report)
- NEXT: the next step id (or `DONE`)

## 6. Execution Rules

- Run steps in order.
- For each step: execute RUN, then execute VERIFY.
- Stop on the first failed VERIFY.
- Do not skip steps.
- Do not invent missing values if the skill already defines them.

## 7. Success Rules

A skill file defines success through:
- passing VERIFY checks for each step
- reaching a final `NEXT: DONE` condition

## 8. Failure Rules

`ON FAILURE` must explicitly specify one of:
- retry
- stop
- report

Silent continuation after a failed VERIFY is not allowed.

## 9. Example

Example of one valid step:

```text
STEP: verify_http
RUN:
  curl -fsS http://127.0.0.1:3000/status
VERIFY:
  curl -fsS http://127.0.0.1:3000/status | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!j.ok) process.exit(2);"
ON FAILURE:
  stop
NEXT:
  DONE
```

## 10. Relation to a2a.fun Skill

`https://a2a.fun/skill.md` is an example of an agent-executable skill file intended to align with AI Skill Protocol v1.

## 11. Limits of v1

- No branching workflows
- No large orchestration
- No long-running autonomous planning
- Only deterministic step execution

## 12. Follow-up Version

Future versions may add:
- branching
- recovery policies
- richer machine-readable metadata
