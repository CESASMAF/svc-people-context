# W1 (implement) — PEO-LINT-ZERO — Lint-zero + promoção warn→error

## Resultado
`bun run lint` → **0 warnings / 0 errors**. As 16 categorias com violação foram
zeradas e TODAS as regras `warn` promovidas a `error`. `bun run verify` (typecheck +
prettier --check + eslint + test + coverage) verde; coverage 97.95% (≥95%).

## Regras promovidas warn→error (22)
- Grátis (já em 0): promise-function-async, prefer-readonly-parameter-types,
  no-unsafe-return, no-unsafe-call, no-unsafe-argument, no-confusing-void-expression.
- Corrigidas + promovidas: strict-boolean-expressions (59→0), naming-convention (15),
  explicit-function-return-type (10), no-non-null-assertion (7), no-unsafe-member-access (6),
  no-empty-function (4), restrict-template-expressions (3, dedup), no-unsafe-enum-comparison (3),
  no-misused-promises (3), no-invalid-void-type (3), no-floating-promises (3),
  no-unsafe-assignment (2), member-ordering (2), prefer-nullish-coalescing (1),
  no-unnecessary-condition (1), no-base-to-string (1).

## Carve-outs de ESCOPO (não exceções de severidade — regra segue `error`)
1. **naming-convention**: snake_case permitido em `typeProperty` SÓ em `src/idp/**`
   (DTOs que espelham o wire-format Authentik DRF/OIDC — nome ditado pelo protocolo).
2. **explicit-function-return-type**: off SÓ em `src/routes/**` (factories Elysia
   retornam tipo genérico inominável sem recorrer a `any`, que é proibido).

## Decisões técnicas de correção (comportamento preservado)
- `request<void>` → `request<undefined>` + `AuthentikResult<void>`→`<undefined>` (no-invalid-void-type).
- INSERT/UPDATE ... RETURNING tipados como tupla `[T]` → elimina `!` (no-non-null-assertion).
- `x === undefined || !x.foo()` colidia com prefer-optional-chain (já error) ↔ a forma
  `x?.foo() !== true` satisfaz strict-boolean E prefer-optional-chain, e o TS mantém o narrowing.
- `||`/`!!`/`!x` em nullable string trocados por checks explícitos preservando "vazio = ausente".

## Investigação de funcionalidade (W0): nenhuma quebra/incompletude (ver W0/REPORT.md).
