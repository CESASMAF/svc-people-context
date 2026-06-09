---
title: "No classes — functional programming only"
scope: "file"
path: ["src/**/*.ts"]
severity_min: "critical"
languages: ["jsts"]
buckets: ["architecture"]
enabled: true
---

## Instructions

This project follows strict functional programming. Classes are banned (non-negotiable).

Flag:

- `class` keyword anywhere in `src/`
- `this` keyword in application code
- `new` keyword (except for external library instantiation like `new Elysia()`)
- `extends` or `implements` on a class
- Prototype manipulation

Use instead:

- Plain objects with `interface` or `type`
- Factory functions (closures) for stateful behavior
- Higher-order functions for composition
- `readonly` on all data properties

## Examples

### Bad example

```typescript
class PersonRepository {
  constructor(private sql: Sql) {}

  async findById(id: string): Promise<Person | null> {
    return this.sql`SELECT * FROM people WHERE id = ${id}`.first();
  }
}
```

### Good example

```typescript
interface PersonRepository {
  readonly findById: (id: string) => Promise<Person | null>;
  readonly create: (input: CreatePersonInput) => Promise<Person>;
}

const createPersonRepository = (sql: Sql): PersonRepository => ({
  findById: async (id) => {
    const [row] = await sql`SELECT * FROM people WHERE id = ${id}`;
    return row ? toPerson(row) : null;
  },
  create: async (input) => {
    /* ... */
  },
});
```
