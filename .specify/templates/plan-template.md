# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

## Migrations postgres.js (people-context)

> Preencher se a feature altera o schema. Migrations são **versionadas e escritas à
> mão** em `src/repository/migrations.ts` (sequenciais, em transação, rastreadas em
> `schema_migrations`). NÃO há geração automática (não usamos Drizzle/ORM).

- **Mudanças de schema**: [ ] tabelas novas · [ ] colunas · [ ] índices · [ ] FKs · [ ] nenhuma
- **Tabela correta?** (`people` / `system_roles` / `outbox_events`) — Princ. VI: [sim/N/A]
- **Outbox**: novo evento exige `INSERT` em `outbox_events` (mesma transação)? [sim/não]
- **Migration**: adicionar entrada sequencial nova em `migrations.ts` (idempotente, `IF NOT EXISTS`).
- **SQL parametrizado** (Princ. VI): tagged templates `sql\`…\``; nome de coluna só via `sql.unsafe(WHITELIST)`.

## Contrato HTTP (Elysia)

> O people-context é **HTTP-first** (Princ. VII). Preencher para todo endpoint novo/alterado.

- **Endpoints novos/alterados**: [método, rota, schema TypeBox (`t.Object`) request/response, status codes]
- **Envelope**: sucesso `{ data, meta: { timestamp } }` · erro `{ success: false, error: { code, message } }` (`PEO/ROL/IDP/AUTH/ADM-xxx`).
- **RBAC/Guard**: [role exigida; `X-Actor-Id` em mutações; escopo de `admin` por sistema]
- **Backward-compat / versionamento**: [...]

## Estimativa de Pipeline (W0 size)

> Define o `--size` do ticket (`bun run pipeline:state init <ticket> --size <S|M|L>`).

- **Tamanho**: [ ] **S** (trivial, 1-3 linhas/config) · [ ] **M** (VO/use case/refactor localizado) · [ ] **L** (BC novo, múltiplos agregados, outbox, API)
- **Justificativa**: [por que esse tamanho]
- **Plano de testes W0 (RED)**: [quais suites `*.test.ts` falham primeiro, descrevendo a API esperada]
