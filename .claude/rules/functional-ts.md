# Regra: TypeScript Funcional (no-class) — people-context

Invariantes de estilo deste serviço. Todo agente interno obedece. Fonte: `CLAUDE.md` + `CONTRIBUTING.md`.

## Proibido
- `class`, `this`, `new` (exceto libs externas), herança.
- `any` → use `unknown` + type guards.
- `enum` → use union literal ou `as const`.
- `throw` na fronteira de domínio/aplicação → erros são **valores** (Result). `throw` só em adapters, convertido a Result no contorno (ADR-014).
- SQL por concatenação → **sempre** tagged template parametrizado (ver [security-lgpd.md](./security-lgpd.md)).

## Obrigatório
- `readonly` em **todas** as propriedades; `readonly T[]` em arrays.
- `type` para unions/intersections; `interface` para shapes de objeto.
- Arrow functions; composição; **factory functions para DI** (closures, não classes).
- `import type { X }` para imports só-de-tipo.
- Branded types em IDs e VOs validados.

## Os DOIS Result deste repo (use o real de cada camada — não invente)

**Domínio — `ValidationResult`** (discriminante `kind`):
```ts
type ValidationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly message: string }
```

**IdP / adapters — `AuthentikResult<T>`** (discriminante `ok`, no-throw boundary):
```ts
type AuthentikResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: number; readonly message: string }
```

> Não unifique os dois nem importe o `Result<T,E>` do `web`. São os contratos REAIS do `people-context`.

## Branded types (smart constructors)
```ts
type PersonId = string & { readonly [Brand]: unique symbol }
type Cpf = string & { readonly [Brand]: unique symbol }
type RoleId = string & { readonly [Brand]: unique symbol }
type IsoDateString = string & { readonly [Brand]: unique symbol }
// toCpf(value): Cpf | null   — valida mod-11, rejeita repdigits
// toIsoDate(value): IsoDateString | null  — YYYY-MM-DD
```

## Camadas e import boundary
```
domain/        ← branded types, VOs, validação, Result (ZERO deps externas)
application/   ← orquestração pura (idp-sync): domain + ports; sem I/O direto
repository/    ← postgres.js (factory DI), migrations, SQL parametrizado
events/        ← Outbox publisher + relay (NATS)
idp/           ← Authentik Management API client (Result-based)
middleware/    ← jwt (jose) + AuthGuard (puro)
routes/        ← Elysia handlers magros (TypeBox validation)
```
`domain/` não importa nada de fora. `application/` orquestra via tipos/ports. I/O vive em `repository/`, `events/`, `idp/`, `middleware/`.

## Sinais de que esta regra está em ação
- `grep -rn "class " src/` → vazio (fora de libs).
- `grep -rn ": any" src/` → vazio.
- `grep -rn "throw " src/domain src/application` → vazio.
- Todo repositório/cliente é criado por `createXxx(deps) => Xxx` (factory).
