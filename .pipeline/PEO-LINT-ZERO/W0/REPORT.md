# W0 (RED) — PEO-LINT-ZERO — Baseline & Investigação

## Investigação de funcionalidade quebrada/pela metade
Varredura cruzada (rotas×handlers, repository×migrations, eventos NATS, application/idp, órfãos).
**Resultado: nenhuma funcionalidade quebrada ou pela metade.**
- typecheck limpo; 255 pass / 8 skip / 0 fail (skips = smoke `skipIf(!live)` Authentik, intencional).
- 12+ endpoints implementados com handler real; `listWithIdpUser` wired (admin/reconcile).
- migrations consistentes com queries (idp_user_pk, idp_user_id, active, email).
- 5+ event builders emitidos; recoveryLink só no NATS (LGPD ok).
- env XOR fail-fast (HIGH-10) correto.
- 4 métodos AuthentikClient "não consumidos por rotas" (findUserByUid, updateUserAttributes,
  listUserGroups, createServiceAccount) são superfície de API **testada** — não dead code.
- Nit cosmético: roles.ts:221/287 `set.status=204` sem `return` explícito (204 funciona; teste cobre).

## Baseline lint (RED) — `bun run lint`
123 warnings, 0 errors, 16 regras com violação + 6 regras warn já em zero.

| regra | n |
|---|---|
| strict-boolean-expressions | 59 |
| naming-convention | 15 |
| explicit-function-return-type | 10 |
| no-non-null-assertion | 7 |
| no-unsafe-member-access | 6 |
| no-empty-function | 4 |
| restrict-template-expressions | 3 |
| no-unsafe-enum-comparison | 3 |
| no-misused-promises | 3 |
| no-invalid-void-type | 3 |
| no-floating-promises | 3 |
| no-unsafe-assignment | 2 |
| member-ordering | 2 |
| prefer-nullish-coalescing | 1 |
| no-unnecessary-condition | 1 |
| no-base-to-string | 1 |

Zero-violação (promoção grátis): promise-function-async, prefer-readonly-parameter-types,
no-unsafe-return, no-unsafe-call, no-unsafe-argument, no-confusing-void-expression.

## Meta W1→W3
Zerar todas as 16 categorias e promover cada regra `warn`→`error` ao zerar.
Gate W3 = `bun run verify` (0 warnings, todas error, coverage ≥95%).
