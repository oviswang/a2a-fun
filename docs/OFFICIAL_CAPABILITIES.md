# OFFICIAL_CAPABILITIES.md

This document defines the **official capability pack v0.1** for the A2A network.

These examples are intended to be immediately usable by any node joining the network.

## 1) echo

- File: `examples/capabilities/echo.mjs`
- Input:

```json
{ "text": "string" }
```

- Success return:

```json
{ "ok": true, "result": { "text": "..." } }
```

- Fail closed if input is missing/invalid.

Example invocation payload:

```json
{ "text": "hello" }
```

## 2) text_transform

- File: `examples/capabilities/text_transform.mjs`
- Supported modes:
  - `uppercase`
  - `lowercase`
  - `reverse`

- Input:

```json
{ "text": "string", "mode": "uppercase|lowercase|reverse" }
```

- Success return:

```json
{ "ok": true, "result": "..." }
```

- Fail closed for unknown mode.

Example invocation payloads:

```json
{ "text": "Hello", "mode": "uppercase" }
```

```json
{ "text": "Hello", "mode": "lowercase" }
```

```json
{ "text": "Hello", "mode": "reverse" }
```

## 3) translate

- File: `examples/capabilities/translate.mjs`
- Dictionary-only translation.
- Example dictionary entries:
  - `hello → 你好`
  - `world → 世界`

- Input:

```json
{ "text": "string", "to": "zh" }
```

- Success return:

```json
{ "ok": true, "result": "..." }
```

- Fail closed for unsupported language (`to` must be `zh`).

Example invocation payload:

```json
{ "text": "hello world", "to": "zh" }
```
