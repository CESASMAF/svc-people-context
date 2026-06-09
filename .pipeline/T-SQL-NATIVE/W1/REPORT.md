# W1 (implement) — T-SQL-NATIVE — DESBLOQUEADO: oráculo + migração + paridade

## Resolução do bloqueio W0 (oráculo ausente)
Construímos o oráculo ANTES de migrar: `tests/repository/repository.integration.test.ts`
(gated por PG_INTEGRATION) contra Postgres real. **Baseline verde com postgres.js (7/7)** = oráculo.

## Migração postgres.js → Bun.sql (interface preservada)
- `db.ts`: `createDb` → `new SQL({ adapter:"postgres", hostname, port, username, password, database, max })`.
- `sql.unsafe(SELECT_FIELDS/SELECT_ROLE)` → fragmentos `Bun.sql` na factory (`const fields = sql\`...\``).
  **Eliminou `sql.unsafe` por completo** (zero raw SQL).
- `ANY(${ids})` → `ANY(${sql.array(ids)})`; `sql.json` → `${JSON.stringify}::jsonb`; `sql.end`→`sql.close`.
- generics `sql<T>`, `sql.begin`, fragmentos condicionais: idênticos (sem mudança).
- `import type { Sql }` migrado de "postgres" → `db.ts` (re-exporta `SQL`).

## Paridade PROVADA
A MESMA suíte de integração ficou **verde com Bun.sql (7/7, 47 expects)** — paridade comportamental.
`postgres` removido das deps → runtime deps 4→3 (`elysia, jose, nats`).

Decisão completa: `docs/adr/0002-driver-postgres-nativo-bun-sql.md`.
