# Changelog

All notable changes to this service will be documented in this file.

## [Unreleased]

### Added

- **Test coverage** — 65 testes novos elevando line coverage de 87.20% para 99.08%, destrancando o gate de 95% do CI.
  - `tests/routes/fake-authentik.ts`: fake `AuthentikClient` configurável (overrides por método + contadores de chamada).
  - `tests/application/idp-sync.test.ts`: 17 testes para `roleKeyForGroup`, `usernameFromEmail`, `findGroupByRoleKey`, `syncRoleAssignment`, `syncRoleRemoval`, `provisionUserInIdp`.
  - `tests/routes/people-lifecycle.test.ts`: 19 testes para `POST /people` com `createLogin`, `PUT /:id/deactivate`, `PUT /:id/reactivate`, `POST /:id/request-password-reset` (incluindo paths 502 e redação de mensagens upstream).
  - `tests/idp/client.test.ts`: 21 testes adicionais cobrindo todos os métodos do `AuthentikClient` + fallbacks do parser de erro.
  - `tests/routes/roles.test.ts`: 5 testes para `ROL-001`, `ROL-007` (cross-system authz) e sync de groups no Authentik.

## [0.4.0] - 2026-05-14

### Removed (BREAKING CHANGE)

- **Pasta `src/zitadel/`** — `ZitadelClient`, types e barrel deletados.
- **`env.zitadel.*`** (`managementUrl`, `serviceAccountToken`, `projectId`) — não mais usado.
- **Bloco `ZITADEL_MANAGEMENT_*`** do `.env.example`.
- Comentários "Strangler Fig" / "Sprint 6 cleanup" / "compat de coluna DB".

### Changed (BREAKING CHANGE)

- **Domain** `Person.zitadelUserId` → `Person.idpUserId`.
- **Repository** `setZitadelUserId(...)` → `setIdpUserId(...)`.
- **Schema do DB**: coluna `people.zitadel_user_id` → `idp_user_id` (e índice `idx_people_zitadel` → `idx_people_idp_user_id`) via **migration v6** `rename_zitadel_to_idp_user_columns` (idempotente, `DO/EXCEPTION` para suportar banco virgem e re-runs).

### Notes

- Validação: `bun run typecheck` ✅, `bun test` 113 pass / 0 fail no momento do commit.
- Follow-up cross-repo (fora do escopo desta release): renomear envs `ZITADEL_ISSUER` / `ZITADEL_INTROSPECT_*` / `ZITADEL_PROJECT_ID` em `env.auth.*` (dependem de Bitwarden + `edge-cloud-infra`) e claim URN `urn:zitadel:iam:org:project:roles` (depende de property mapping no Authentik).

## [0.3.1] - 2026-04-14

### Security

- **Privilege escalation mitigada (system-scoped RBAC).** Antes desta correção qualquer usuário com `worker`/`admin` podia atribuir qualquer role em qualquer sistema, se autopromover, ou atravessar sistemas.
  - Apenas `admin` pode atribuir roles (removido `worker` do assign).
  - `admin` escopado ao próprio sistema: `social-care:admin` só gerencia `social-care`.
  - Apenas `superadmin` pode atribuir role `superadmin` (`ROL-006`).
  - Cross-system assignment bloqueado (`ROL-007`).
  - Self-assignment bloqueado (`ROL-008`, exceto `superadmin`).
  - `superadmin` bypassa role checks no auth guard.
  - Composite role matching: claim `social-care:admin` satisfaz guard que exige `admin`.
- Renomeado `social_worker` → `worker` em todos os route guards.
- 8 novos testes cobrindo cada vetor de escalada.

## [0.3.0] - 2026-04-13

### Added

- **Zitadel Management API client** — `createUser`, `deactivate`/`reactivate`, `passwordReset`, user grants.
- **Endpoints de ciclo de vida**: `PUT /people/:id/deactivate`, `PUT /people/:id/reactivate`, `POST /people/:id/request-password-reset` — todos com sync para Zitadel.
- **Sync de roles**: role assignment vira user grant no Zitadel; deactivate remove o grant.
- **Migration v4** (`add_zitadel_user_columns`): colunas `email`, `zitadel_user_id`, `active` na tabela `people`.
- **Domain validation** para `email` e `createLogin`.
- **5 novos eventos NATS**: `user.provisioned`, `user.deactivated`, `user.reactivated`, `password_reset_requested`.
- Fallback noop quando `ZITADEL_MANAGEMENT_URL` não está configurado.

## [0.2.2] - 2026-04-13

### Fixed

- **CI**: `bun.lock` atualizado e Dockerfile usa `bun compile` para deploy de binário único (~80 MB).

## [0.2.1] - 2026-04-12

### Fixed

- **JWT role claim key** corrigido para incluir Zitadel `project_id` no formato `urn:zitadel:iam:org:project:<projectId>:roles`. Tokens validados contra o project correto.

### Added (chore)

- **PR Size Guard** workflow.
- **Dependabot** (npm + GitHub Actions), **CodeQL** scanning, **Kodus AI** code review.
- **SBOM** gerada no pipeline.
- GitHub Actions pinadas em SHAs (supply chain hardening).
- Bumps de `postgres` (3.4.8 → 3.4.9), `actions/checkout` (4.3.1 → 6.0.2), `github/codeql-action` (3 → 4).

### Removed

- Workflow `auto-version` (substituído por versionamento manual com tags semânticas).

## [0.2.0] - 2026-04-06

### Added

- **Transactional Outbox** — substituição do publish direto NATS pela combinação outbox table + relay (entrega at-least-once garantida).
- **Sistema de migrations versionado** com tabela `schema_migrations`.
- **Validação CPF com check digits** — rejeita CPFs com todos os dígitos iguais e checksums inválidos.
- **Validação UUID/CPF nos path params** das rotas (400 antes do hit no DB).
- **Transaction + FOR UPDATE** no role assignment (previne race condition).
- **`/ready` enriquecido**: DB + NATS + outbox backlog.
- **Validação JWKS no startup** (fail-fast em produção).
- **Timeout + error logging** no token introspection.
- **Env vars críticas obrigatórias em produção** via `requireInProd`.
- **Gate de cobertura de 95%** (line) no CI.
- **Graceful shutdown** (SIGTERM/SIGINT, drain do relay).
- **NATS** no `docker-compose`.
- 26 novos testes (health, auth-guard, JWT, publisher, asserções de evento nas rotas).

### Changed

- `deactivate`/`reactivate` retornam o `SystemRole` completo (elimina query extra para eventos).

### Fixed

- OCI labels (`org.opencontainers.image.*`) movidas para dentro do build stage do Dockerfile.

## [0.1.0] - 2026-04-02

### Added

- **People Context service** — central identity registry for the ACDG ecosystem. Registers person existence and tracks domain roles across systems.
- **Domain layer** with branded types (`PersonId`, `Cpf`, `RoleId`, `IsoDateString`), discriminated union validation results, and union types for known systems/roles.
- **12 REST endpoints** (OpenAPI 3.1 compliant):
  - Person: `POST /people` (register with CPF dedup), `GET /people` (paginated + search), `GET /people/:id`, `GET /people/by-cpf/:cpf`, `PUT /people/:id` (update).
  - Roles: `POST /people/:id/roles` (assign, idempotent), `GET /people/:id/roles` (list), `PUT .../deactivate`, `PUT .../reactivate`, `GET /roles` (cross-person query).
  - Health: `GET /health` (liveness), `GET /ready` (readiness).
- **JWT/JWKS authentication** via Zitadel (`jose` library, RS256 verification).
- **RBAC enforcement** on all endpoints: `social_worker` for writes, `social_worker/owner/admin` for reads, `admin` for role deactivation/reactivation.
- **Token introspection fallback** (RFC 7662) for service accounts in HML, with explicit allowlist to prevent escalation.
- **X-Actor-Id header** required on all mutation endpoints.
- **NATS event publishing** (conditional via `NATS_URL`): 5 domain events (`person.registered`, `person.updated`, `role.assigned`, `role.deactivated`, `role.reactivated`) with `EventMetadata + actorId` envelope.
- **PostgreSQL** dedicated database (`people`) with idempotent migrations on startup.
- **47 tests** across 5 test files: domain validation (18), route handlers (25), auth middleware (4). Zero `any`, strict TypeScript.
- **CI/CD**: GitHub Actions workflows for typecheck + test (PR/push) and Docker image build/push to GHCR (tags).
- **K8s manifests**: production (`people-context.yaml`) and staging (`people-context-hml.yaml`) with dedicated PostgreSQL StatefulSets, BitwardenSecret CRDs, Traefik ingress, and weekly HML DB reset CronJob.
- **Docker**: multi-stage Dockerfile with `oven/bun:slim`, ~80MB image.

### Stack

- Runtime: Bun 1.3.11
- HTTP: Elysia 1.4.28
- Database: PostgreSQL 15 (postgres.js 3.4.8)
- Events: NATS (nats.js 2.29.3)
- Auth: JWT via jose 6.2.2
