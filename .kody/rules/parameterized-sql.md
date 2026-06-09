---
title: "Use parameterized queries via tagged templates"
scope: "file"
path: ["src/repository/**/*.ts"]
severity_min: "critical"
languages: ["jsts"]
buckets: ["security"]
enabled: true
---

## Instructions

All SQL queries must use `postgres.js` tagged template literals for parameterization. This automatically prevents SQL injection.

Flag:

- String concatenation in SQL queries (`"SELECT * FROM " + table`)
- Template literals without tag function (`` `SELECT * FROM ${table}` `` without `sql` tag)
- `query()` or `exec()` with string arguments
- Any pattern where user input flows into SQL without parameterization

Allowed:

- Tagged templates: `` sql`SELECT * FROM people WHERE id = ${id}` ``
- Static SQL in migrations (no user input)

## Examples

### Bad example

```typescript
const findByName = async (name: string) => {
  const result = await sql.unsafe(`SELECT * FROM people WHERE name = '${name}'`);
  return result;
};
```

### Good example

```typescript
const findByName = async (name: string) => {
  const [row] = await sql`SELECT * FROM people WHERE name = ${name}`;
  return row ? toPerson(row) : null;
};
```
