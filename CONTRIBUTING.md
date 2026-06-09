# Contributing

Thank you for your interest in contributing to the People Context service.

## Getting Started

```bash
# Clone and install
bun install

# Start PostgreSQL
docker compose up postgres -d

# Configure environment
cp .env.example .env

# Run in dev mode
bun run dev

# Run tests
bun test

# Type check
bun run typecheck
```

## Code Guidelines

**Read `CLAUDE.md` before writing any code.** It contains all conventions.

Key rules:

- **Functional TypeScript only** — no classes, no `this`, no `any`
- **`type` over `interface`** — use type aliases for all shapes
- **`unknown` over `any`** — always narrow with type guards
- **`readonly` by default** — all properties immutable
- **Branded types** for domain IDs (`PersonId`, `Cpf`, `RoleId`)
- **Discriminated unions** for results (`{ kind: "ok" } | { kind: "error", message }`)
- Factory functions for dependency injection (`createPersonRepository(sql)`)

## Pull Request Process

1. Branch from `main` using `feat/<slug>`, `fix/<slug>`, or `chore/<slug>`
2. Ensure `bun run typecheck` and `bun test` pass
3. Follow Conventional Commits for commit messages
4. One logical change per PR

## Testing

- Domain: pure function tests (no DB)
- Routes: fake repositories + fake auth guard (no DB)
- All tests must pass before merge
- Target: 95% coverage
