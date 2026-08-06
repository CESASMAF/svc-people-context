# CLAUDE.md — people-context

## Service

Central identity registry for the ACDG ecosystem. Registers person existence and tracks domain roles across systems. Minimal by design.

## Commands

```bash
bun run dev          # Run with --watch (hot reload)
bun run start        # Run production
bun test             # Run tests
bun run typecheck    # TypeScript strict check

# Docker
docker compose up postgres -d   # Start database only
cp .env.example .env            # Configure environment
bun run dev                     # Run service locally

# Full Docker
docker compose up --build
```

## Stack

- **Runtime**: Bun 1.3.14
- **Language**: TypeScript 6.0 (`types: ["bun"]` — ver `docs/adr/0001`)
- **HTTP**: Elysia 1.4.28
- **Database**: PostgreSQL 15 (dedicated, database-per-service)
- **Events**: NATS JetStream via nats.js 2.29.3
- **Auth**: JWT validation via Authentik OIDC JWKS (RS256). Roles via claim `groups` (homônimos a `system:role`). Migrado de Zitadel.

## TypeScript Guidelines

As invariantes de estilo — no-class, no-any, no-throw no domínio, `readonly`,
branded types, factory functions para DI e o import boundary entre camadas —
vivem em `.claude/rules/functional-ts.md`, que carrega automaticamente. **Não
duplicar aqui.** (Não há espelho local de doc de TypeScript: `handbook/references/`
tem apenas um README. Para fatos de doc, use a Reference Network —
`acdg-ref:ref-elysia`, `ref-postgresql`, `ref-nats`.)

## Architecture

```
src/
├── config/       # Environment variables, constants
├── domain/       # Types, interfaces, validation functions (pure, no deps)
├── repository/   # PostgreSQL queries (functional, injected sql)
├── routes/       # Elysia route handlers (thin, delegate to repository)
├── middleware/    # Auth (JWT/JWKS), error handling
├── events/       # Transactional Outbox (publisher.ts) + NATS relay (outbox-relay.ts)
└── index.ts      # App bootstrap
```

### Domain layer has NO external dependencies. Pure types and functions only.

## Security (Private Cloud Directives)

- **JWT validation**: Verify RS256 signature against Authentik OIDC JWKS. Issuer/JWKS derived from `AUTHENTIK_URL` + `AUTHENTIK_APP_SLUG` (`<url>/application/o/<slug>/` and `.../jwks/`), with `OIDC_ISSUER`/`JWKS_URL` overrides. Optional `aud` check via `OIDC_AUDIENCE`.
- **RBAC**: Role claims from JWT `groups` claim (array of group names, homônimos a `system:role` + `superadmin`; configurable via `OIDC_ROLES_CLAIM`). Guard mutation endpoints.
- **X-Actor-Id**: Required header on all mutation endpoints (POST, PUT, DELETE).
- **Secrets**: NEVER hardcoded. Environment variables only, sourced from Bitwarden Secrets Manager in production.
- **SQL injection**: Always use parameterized queries via `Bun.sql` tagged templates (native driver; see `docs/adr/0002`).
- **Health endpoints**: `/health` and `/ready` have NO auth (`security: []`).

## Database

- **Dedicated PostgreSQL**: `people` database, separate from all other services.
- **Naming**: Tables lowercase with underscores (`people`, `system_roles`).
- **Migrations**: Versioned, sequential migrations in `repository/migrations.ts`. Tracked in `schema_migrations` table. Each migration runs in a transaction.
- **Connection pool**: Max 10 connections via `Bun.sql` (native Postgres driver).

## Conventions

- **Naming**: All code, schemas, API responses in **English**.
- **Response envelope**: `{ data, meta: { timestamp } }` for all successful responses.
- **Error envelope**: `{ success: false, error: { code, message } }`.
- **Error codes**: `PEO-XXX` for person errors, `ROL-XXX` for role errors.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.).
- **Versioning**: SemVer. `feat:` → minor bump, `fix:` → patch bump.

## Contracts

API contracts defined in `contracts/services/people/` (separate repo):

- OpenAPI 3.1: 12 endpoints (Person 5, Roles 5, Health 2)
- AsyncAPI 3.1: 5 NATS events
- 19 canonical YAML schemas

## Testing

- Framework: `bun test` (built-in, Jest-compatible API)
- Coverage target: ≥95% line coverage (enforced in CI via `bun run coverage`)
- Test files: `tests/**/*.test.ts`
- Pattern: pure functions → easy to test without mocks
- Coverage gate script: `scripts/check-coverage.js`

## Quality gates (ESLint + Prettier + types + tests)

Controle de qualidade portado do `core-api`. Os 5 checks nascem **verdes**:

```bash
bun run verify   # typecheck && format:check && lint && test && coverage (≥95%)
```

- **ESLint flat** (`eslint.config.js`, `typescript-eslint` strict+stylistic type-checked).
  Invariantes duras são `error` (no-class, no-any, no-throw em domain/application via
  `no-restricted-syntax`, libs proibidas); dívida de adoção é `warn` rastreável
  (`strict-boolean-expressions` etc.) — cada ticket zera os warns do arquivo que toca.
- **Prettier** (`.prettierrc.json`): printWidth 100, **double-quote** (estilo do repo), semi.
- Overrides por camada: `domain/application` proíbem `throw`; adapters e `routes` relaxam
  `require-await`/readonly; `tests` relaxa fakes.

## Reference Network — consulta fria (especialistas externos)

Para FATOS de documentação de tecnologias (sintaxe, versão exata, comportamento), não responda de memória nem chute: consulte o especialista **EXTERNO read-only**, que cita a doc oficial offline (`infra/reference/`) ou recusa. Divisão: você (interno) conhece o código e **decide**; ele (externo) só entrega o **fato citado** — nunca vê seu código.

Invocação: delegue isolado via `subagent_type: "acdg-ref:ref-<tech>"`, ou direto `/acdg-ref:ref-<tech> <pergunta>`.

| Dúvida sobre…                                                     | Consulte         |
| ----------------------------------------------------------------- | ---------------- |
| Elysia: handler, validação (TypeBox/`t`), lifecycle, plugin, Eden | `ref-elysia`     |
| SQL, tipos, funções, GUCs, índices (PostgreSQL)                   | `ref-postgresql` |
| NATS/JetStream: subjects, consumers, ack, Outbox                  | `ref-nats`       |
| Authentik: OIDC/OAuth2 provider, claims/scopes                    | `ref-authentik`  |

Ainda **fora da rede** (P2): `jose` (JWT) e Bun runtime.

Regras: passe a pergunta como **texto** (não mande "olhe meu arquivo X" — ele recusa). Se retornar `NÃO ENCONTRADO`, não invente: escale ou peça download da doc. Detalhes: `infra/reference-network/README.md`.
