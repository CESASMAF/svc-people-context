# W3 (GREEN) — T-SQL-NATIVE

- `bun run verify` EXIT 0: typecheck + prettier + eslint(0/0) + 255 testes + coverage 97.95%.
- Oráculo de integração: 7 pass / 0 fail com **Bun.sql** (e com postgres.js no baseline) = paridade.
- `postgres` removido; runtime deps 4→3.
- CI: novo job `integration` (service Postgres) roda o oráculo — repository testada no CI pela 1ª vez.
- Docs atualizados (CLAUDE.md, README, .claude/rules, ADR-0002).
