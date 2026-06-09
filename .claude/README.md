# .claude/ — estrutura interna do people-context

Estrutura de agentes/skills internos deste serviço (Bun/Elysia/TS funcional). Espelha o estilo do
`web` (orquestrador opus + experts sonnet por camada), adaptado à arquitetura real do `people-context`.

## Entrada
**Sempre comece pelo [`people-orchestrator`](./agents/people-orchestrator.md)** — ele roteia para o expert
da camada certa (um por vez) e delega fatos frios de doc à Reference Network.

## Agentes (`agents/`) — internos, conhecem o código (podem editar)
| Agente | Camada / responsabilidade |
|---|---|
| `people-orchestrator` | roteador único (opus) |
| `functional-domain-expert` | `domain/` — branded types, VOs, `ValidationResult` |
| `application-expert` | `application/` — orquestração pura, idp-sync (ADR-029) |
| `repository-expert` | `repository/` — postgres.js, migrations, SQL parametrizado |
| `events-outbox-expert` | `events/` — Outbox publisher + relay, subjects NATS |
| `auth-idp-expert` | `middleware/` + `idp/` — JWT/JWKS, RBAC, Authentik Mgmt API |
| `elysia-http-expert` | `routes/` — handlers Elysia, TypeBox, envelope, error codes |
| `test-writer` | `tests/` — bun:test, fakes in-memory, gate ≥95% |

## Skills (`skills/`) — fluxos operacionais
| Skill | Faz |
|---|---|
| `quality-gate` | `typecheck` + `test` + cobertura ≥95% → ALL GREEN ou BLOCKED |
| `add-endpoint` | adiciona um endpoint ponta-a-ponta (domain → repo → route → outbox → testes) |

## Regras (`rules/`) — invariantes compartilhadas
- [`functional-ts.md`](./rules/functional-ts.md) — no-class, Result (os 2 reais), branded types, camadas.
- [`security-lgpd.md`](./rules/security-lgpd.md) — SQL parametrizado, CPF fora de eventos, IdP-first, RBAC, reset-link via NATS.

## Reference Network (externos, read-only — consulta fria)
Os experts internos consultam especialistas EXTERNOS para fatos de doc (eles citam a doc offline ou
recusam, nunca veem o código): `ref-elysia`, `ref-postgresql`, `ref-nats`, `ref-authentik`
(`subagent_type: "acdg-ref:ref-<tech>"`). Plugin habilitado em `.claude/settings.json`.
Ver `infra/reference-network/README.md`.

## Nota de auth (transição)
`middleware/jwt.ts` ainda valida JWKS do **Zitadel**; o alvo do deploy BV é **Authentik** (o `idp/client.ts`
já é Authentik). A migração da verificação JWT é pendência conhecida — ver `rules/security-lgpd.md`.
