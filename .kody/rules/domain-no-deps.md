---
title: "Domain layer must have no external dependencies"
scope: "file"
path: ["src/domain/**/*.ts"]
severity_min: "critical"
languages: ["jsts"]
buckets: ["architecture"]
enabled: true
---

## Instructions

The domain layer contains only pure types and functions. No external imports.

Flag:

- Import from `postgres`, `nats`, `elysia`, or any runtime library
- Import from `src/repository/`, `src/routes/`, `src/middleware/`, `src/events/`
- Side effects (network calls, database queries, file I/O)

Allowed:

- Imports from other domain files
- Pure validation functions
- Type definitions (interface, type)
