# Constituição do people-context

> **Fonte de verdade:** esta constituição **resume** os princípios para guiar o
> fluxo do spec-kit (plan/tasks/implement). Ela **não substitui** o cânone — quando
> houver divergência, vencem, nesta ordem: `CLAUDE.md` (raiz do serviço) →
> `.claude/rules/` (`functional-ts.md`, `security-lgpd.md`) → ADRs/findings de AppSec
> citados nas rules. Não duplique regras aqui; referencie.

## Core Principles

### I. TDD fail-first em pipeline W0→W3 (NÃO-NEGOCIÁVEL)
Toda mudança em código de produção abre ticket em `.pipeline/<TICKET-ID>/`
(`bun run pipeline:state init <ticket> --size <S|M|L>`) e percorre as waves:
**W0** testes RED antes de tocar `src/`; **W1** implementação mínima até GREEN;
**W2** code review read-only (máx. 3 rounds); **W3** quality gate verde
(`typecheck` + `format:check` + `lint` + `test` + `coverage` ≥95%). Pular wave quebra
o fail-first. Bug trivial (1-3 linhas) ou config pode ir direto.

### II. Política de regressão zero (NÃO-NEGOCIÁVEL)
Qualquer vermelho — teste, `lint`, `typecheck`, `format:check`, gate de cobertura,
hook, gate W3 — é regressão a corrigir AGORA, tenha ou não sido causado pelo diff
atual. "Não é meu erro" / "já estava quebrado" não fecham wave. Saídas aceitas:
consertar a causa; corrigir o gate mal-gateado **provando** o verde no caminho certo;
ou escalar ao humano com causa-raiz.

### III. Bun é o único runtime e package manager
Nunca `npm`/`pnpm`/`yarn`/`npx` — o runtime, o test runner e o gerenciador são o
**Bun 1.3**. Comandos canônicos: `bun run dev`, `bun test`, `bun run typecheck`,
`bun run lint`, `bun run format`, `bun add`. Docs/PRs/scripts que citem outro PM
devem ser convertidos. *(CLAUDE.md §Commands/Stack)*

### IV. Arquitetura funcional em camadas com import boundary estrito
`domain/` (branded types, VOs, validação, Result — **ZERO deps externas**) ←
`application/` (orquestração pura: domain + ports, sem I/O direto) ←
`repository/` · `events/` · `idp/` · `middleware/` (I/O: postgres.js, NATS, Authentik,
jose) ← `routes/` (handlers Elysia magros). `domain/` não importa nada de fora;
`application/` orquestra via tipos/ports. Violar a fronteira é bug arquitetural.
*(.claude/rules/functional-ts.md §"Camadas e import boundary")*

### V. Domínio puro — sem classes, sem framework, sem throw
Sem `class`/`this`/`new` (exceto libs externas), sem herança, sem `any` (use
`unknown` + type guards), sem `enum` (union literal/`as const`). Erros são **valores**:
`ValidationResult` (`kind: "ok"|"error"`) no domínio; `AuthentikResult<T>`
(`ok: true|false`) na fronteira de IdP/adapters. `throw` só em adapters, convertido a
Result no contorno (ADR-014). `readonly` em todas as propriedades. Branded types
(`PersonId`, `Cpf`, `RoleId`, `IsoDateString`) com smart constructors.
*(.claude/rules/functional-ts.md)*

### VI. PostgreSQL dedicado + postgres.js parametrizado (NÃO-NEGOCIÁVEL p/ SQL)
Banco `people` dedicado (database-per-service), pool máx. 10. SQL **100%
parametrizado** via tagged templates `sql\`... ${value} ...\``; **nunca** interpolar
string em SQL. Nomes de coluna dinâmicos só via `sql.unsafe(WHITELIST)` com lista
fixa validada. Migrations versionadas, sequenciais, em transação, rastreadas em
`schema_migrations`. *(CLAUDE.md §Database · .claude/rules/security-lgpd.md §SQL)*

### VII. HTTP-first via Elysia; envelope padronizado
A borda é Elysia com validação TypeBox (`t.Object`, `t.String`…). Sucesso →
`{ data, meta: { timestamp } }`; erro → `{ success: false, error: { code, message } }`
com código estruturado (`PEO-xxx`, `ROL-xxx`, `IDP-xxx`, `AUTH-xxx`, `ADM-xxx`).
207 multi-status para provisioning parcial. Handlers magros delegam à `application/`
e `repository/`. *(CLAUDE.md §Conventions · elysia-http-expert)*

### VIII. Segurança & LGPD — minimização de PII (NÃO-NEGOCIÁVEL)
**CPF nunca entra em payload de evento NATS** (AppSec HIGH-8); eventos de pessoa só
carregam `fullName`/`birthDate`/ids. PII não vaza em logs nem mensagens de erro.
Password reset link viaja **apenas** no evento NATS (ADR-030), nunca no response HTTP.
Provisionamento **IdP-first** (Authentik antes do DB; sem rollback compensatório).
Erros do Authentik mapeados para `IDP-00x` genérico — não vazam. AuthZ: `actorId` =
`JWT.sub` (ADR-023), `X-Actor-Id` obrigatório em mutações; `superadmin` faz bypass;
`admin` escopado ao próprio sistema. Secrets só via env (fail-fast no startup).
*(.claude/rules/security-lgpd.md)*

### IX. TypeScript strict + ESM + idioma por camada
`strict` completo (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
`noImplicitOverride`, `noUnusedLocals/Parameters`). `import type` para tipos; ESM
com `export/import`; barrel `index.ts` por módulo. Lint flat (`typescript-eslint`
strict+stylistic type-checked): invariantes duras (`no-class`, `no-any`, `no-throw`
em domain/application, libs proibidas) são `error`; dívida de adoção é `warn`
rastreável. Idioma: **código em EN**, diálogo/docs/commits em **PT-BR** (acentuação
obrigatória; `feat(people): …`). *(eslint.config.js · CLAUDE.md §TypeScript Guidelines)*

### X. Decisões ancoradas no cânone (consultoria ACDG + citação obrigatória)
A pipeline `people-context-sdd` opera em **máximo rigor**: cada fase consulta a
persona-consultora ACDG (prompts MCP `/acdg-skills:*` — requirements-engineer,
ddd-architect, software-architect, database-engineer, tdd-strategist,
clean-code-reviewer, security-reviewer) **e** delega a execução ao agente interno da
camada (functional-domain-expert, application-expert, repository-expert,
elysia-http-expert, events-outbox-expert, auth-idp-expert, test-writer). Toda
**decisão-chave** — fronteira de camada/agregado (DDD), ADR, estratégia de teste
(TDD), achados de review — exige **citação literal ≥4 linhas** de fonte canônica via
`skills_buscar`/`skills_citar` (Evans, Vernon, Beck, Uncle Bob, Newman,
Ramakrishnan, OWASP…). Sem citação, a decisão não avança o gate. Fatos frios de doc
de stack (Elysia/Postgres/NATS/Authentik) vêm da Reference Network (`acdg-ref:ref-*`),
não da memória. *(MCP `acdg-skills`, `.mcp.json`)*

## Ciclo RED → YELLOW → GREEN (mapeia no W0→W3)

- 🔴 **RED** — testes (W0) escritos a partir do BDD e **falhando** por inexistência da API.
- 🟡 **YELLOW** — implementação mínima (W1) faz os **testes passarem**, mas review/qualidade/
  citações ainda **pendentes** (verde funcional ≠ verde de qualidade).
- 🟢 **GREEN** — testes + **review W2** + **gate W3** (`/speckit-verify`) + **citações das
  decisões-chave registradas**. Só então a feature fecha.

## Technology Constraints

Stack fixa: **Bun 1.3.11** · TypeScript 5.9 · ESM · **Elysia 1.4** (HTTP/TypeBox) ·
**postgres.js 3.4** (PostgreSQL 15, database-per-service) · **NATS** (JetStream,
Transactional Outbox) · **jose** (JWT/JWKS, Authentik OIDC) · `bun:test` ·
ESLint flat (`typescript-eslint`) + Prettier · cobertura ≥95% (`scripts/check-coverage.js`).
Mudar qualquer item exige ADR novo que `supersedes` o anterior. Nunca contradizer
ADR aceito nem as rules de `.claude/rules/`.

## Development Workflow & Quality Gates

- **Gate W3 (obrigatório antes de fechar ticket/feature):**
  `bun run typecheck && bun run format:check && bun run lint && bun test && bun run coverage`.
  (Materializado pela skill `/speckit-verify`, que estende a `quality-gate` existente.)
- **Pipeline state:** `bun run pipeline:status` para o dashboard; tickets fechados são
  histórico auditável — não deletar.
- **Roteamento:** entrada única pelo `people-orchestrator`; um agente OU uma skill por
  vez. Não duplicar regras que já vivem no `CLAUDE.md` / `.claude/rules/` / SKILL.md.

## Governance

Esta constituição serve ao fluxo spec-kit e está **subordinada** ao cânone do serviço
(`CLAUDE.md`, `.claude/rules/`, ADRs). Em conflito, o cânone vence. Toda feature
planejada via `/speckit-plan` passa pelo "Constitution Check" verificando os princípios
I–X; uma violação só é aceitável com justificativa explícita na seção "Complexity
Tracking" do plano. Alterações de stack ou de princípio exigem ADR novo (com
`supersedes`), não edição aqui.

**Version**: 1.0.0 | **Ratified**: 2026-06-09 | **Last Amended**: 2026-06-09 (port inicial do core-api-sdd → people-context-sdd)
