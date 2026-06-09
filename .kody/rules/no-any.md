---
title: "Never use 'any' — use 'unknown' and narrow"
scope: "file"
path: ["src/**/*.ts"]
severity_min: "high"
languages: ["jsts"]
buckets: ["security", "style-conventions"]
enabled: true
---

## Instructions

`any` bypasses TypeScript's type system entirely. Use `unknown` and narrow with type guards.

Flag:

- `any` type annotation (`: any`, `as any`, `<any>`)
- Type assertions that widen to `any` (`value as any`)
- Generic defaults to `any`

Allowed:

- External library type definitions that use `any` internally
- `catch (e)` where `e` is implicitly `unknown` in strict mode
