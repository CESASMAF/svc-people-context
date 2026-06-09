---
title: "All data properties must be readonly"
scope: "file"
path: ["src/**/*.ts"]
severity_min: "high"
languages: ["jsts"]
buckets: ["style-conventions"]
enabled: true
---

## Instructions

Immutability by default. All interface properties and object types must use `readonly`.

Flag:

- Interface properties without `readonly`
- Type alias object properties without `readonly`
- Use of `let` where `const` would suffice
- Mutable array operations (`push`, `splice`) when spread/concat would work

Allowed:

- Loop variables (`for (let i = ...`)
- Reassignment in reducer patterns
- External library types that don't use readonly

## Examples

### Bad example

```typescript
interface Person {
  id: string; // Missing readonly
  name: string;
  roles: string[];
}
```

### Good example

```typescript
interface Person {
  readonly id: string;
  readonly name: string;
  readonly roles: readonly string[];
}
```
