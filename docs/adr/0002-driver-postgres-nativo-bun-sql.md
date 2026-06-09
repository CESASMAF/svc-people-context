# ADR-0002: Driver de Postgres nativo (`Bun.sql`) no lugar de postgres.js

**Status**: Accepted

**Data**: 2026-06-09

**Escopo**: `people-context`. Decisão de runtime/infra, série local (ver ADR-0001).

**Decisores**: Gabriel Aderaldo (+ Claude Code) · ticket `.pipeline/T-SQL-NATIVE/`

## Contexto

A pesquisa "node_modules-zero" (decidida pelo `scrum-master`) concluiu que **não** é possível
zerar o `node_modules`, mas é possível **reduzir 4 → 3 dependências de runtime** trocando
`postgres@3.4.9` (postgres.js) pelo driver **nativo do Bun** (`Bun.sql`). As outras três
(`jose`, `nats`, `elysia`) são insubstituíveis (segurança, protocolo, framework).

A troca respeita a **design rule** do serviço (Baldwin & Clark / Cai & Kazman, citado na pesquisa):
o driver já vive atrás da factory `createXxxRepository(sql)` e do tipo `Sql` — uma fronteira estável.
Trocar o driver é uma mudança **localizada**, que não vibra pelo sistema, _desde que a interface não mude_.

**Bloqueio inicial (W0):** a camada `repository/` **não tinha oráculo de teste** — os repos reais
nunca eram importados por nenhum teste (só fakes), não apareciam na cobertura, e nenhum teste tocava
Postgres real. Trocar o driver e rodar `verify` daria verde **sem validar nada** do que mudou —
inaceitável para I/O com dados de saúde (LGPD). O ticket foi aberto BLOQUEADO até existir oráculo.

## Decisão

1. **Construímos o oráculo primeiro** (`tests/repository/repository.integration.test.ts`): suíte de
   integração contra Postgres real (gated por `PG_INTEGRATION`), exercitando CRUD de pessoa, role
   assign/tx/idempotência, paginação por cursor, busca, `listWithIdpUser`, `remove` (tx) e `query`
   (JOIN). **Baseline verde com postgres.js** = o oráculo.
2. **Migramos `createDb` para `Bun.sql`** (`new SQL({ adapter:"postgres", hostname, port, username,
password, database, max })`) e ajustamos a camada **sem mudar a interface** (`Sql` agora = `SQL` do
   Bun; factories e ports idênticos):
   - `sql.unsafe(SELECT_FIELDS)` (fragmento de colunas via postgres.js) → **fragmento `Bun.sql`**
     (`const fields = sql\`id, full_name AS "fullName", …\``) criado na factory. Elimina o `sql.unsafe`
     por completo — melhoria de segurança (zero raw SQL).
   - `ANY(${ids})` → `ANY(${sql.array(ids)})` (outbox relay).
   - `sql.json(payload)` → `${JSON.stringify(payload)}::jsonb` (publisher).
   - `sql.end({timeout})` → `sql.close({timeout})` (shutdown).
   - generics (`sql<Person[]>`), `sql.begin(async tx => …)` e fragmentos condicionais
     (`${cond ? sql\`…\` : sql\`\`}`) funcionam **igual** — sem mudança.
3. **Provamos paridade**: a MESMA suíte de integração ficou verde com `Bun.sql` (7/7).
4. **Removemos `postgres`** das dependências; runtime deps: `elysia, jose, nats` (4 → 3).
5. **CI**: novo job `integration` com service container Postgres roda o oráculo (`PG_INTEGRATION=1`) —
   a camada repository passa a ser testada no CI pela primeira vez.

## Citação canônica

> Decisão de tooling/runtime — fundamentada nas fontes upstream (princípio IX por analogia ao ADR-0001):

- **Bun.sql** (`handbook/references/bun/runtime/sql.mdx`): driver nativo Promise-based; `sql.begin`
  reserva conexão dedicada do pool (:808); `sql.array` para `ANY` (:391); fragmentos condicionais
  via `${cond ? frag : sql\`\`}`(:342-351);`sql.close({timeout})` (:950). **Gap conhecido**: sem
  LISTEN/NOTIFY/COPY (:1293-1299) — irrelevante aqui (o outbox já é **polling**).
- **Modularidade** (Cai & Kazman, _Hotspot Patterns_): módulos independentes podem ser trocados sem
  afetar os demais _enquanto a design rule (a interface `Sql`/factory) permanecer estável_.

## Alternativas consideradas

- **Manter postgres.js** — rejeitada: perde-se a redução de dependência; um fornecedor a mais para
  auditar (supply-chain).
- **Migrar às cegas (sem oráculo)** — rejeitada (o bloqueio W0): `verify` daria verde sem validar o
  driver; risco LGPD inaceitável.
- **Reescrever via `sql.unsafe` com params posicionais** — rejeitada: perde a segurança do tagged
  template; o fragmento `Bun.sql` é mais limpo e elimina `unsafe`.

## Consequências

- **Positivas**: −1 dependência de runtime; **zero `sql.unsafe`** (raw SQL eliminado); objetos de row
  via JSC internals; a camada repository ganhou **cobertura de integração real** (antes 0); driver
  alinhado ao runtime (Bun 1.3.14).
- **Negativas / trade-offs**: `Bun.sql` é mais novo que postgres.js (anos em prod) — mitigado pelo
  oráculo + CI. O job de integração exige um Postgres no CI (service container). Sem LISTEN/NOTIFY
  (não usado).
- **Impacto em BCs / outbox / migrations**: **nenhum** — interface (`Sql`/factories) preservada;
  outbox/migrations seguem idênticos. Paridade provada (oráculo verde com os dois drivers).
