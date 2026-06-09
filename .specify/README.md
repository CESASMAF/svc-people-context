# Pipeline SDD — `people-context-sdd`

Pipeline **spec-driven (SDD)** de máximo rigor do `people-context`, **portado do
`core-api-sdd`** e adaptado à stack Bun/Elysia/PostgreSQL/funcional (no-class). Materializa
o ciclo **RED → YELLOW → GREEN** (waves W0→W3) com gates humanos, consultoria de personas
ACDG e **citação canônica obrigatória**.

## Pré-requisitos (uma vez)

1. **MCP `acdg-skills` conectado** (`.mcp.json`) — fornece as personas `/acdg-skills:*` e as
   tools `skills_buscar` / `skills_citar` (citação literal ≥4 linhas).
2. **CLI `specify`** no PATH (opcional — só para `specify workflow status`; o motor real é o
   Claude in-session, ver RUNBOOK §1).
3. Toolchain de qualidade instalado (`bun install`) — ESLint, Prettier, typescript-eslint.

## Como rodar (orquestração in-session)

O `workflows/people-context-sdd/workflow.yml` é a **receita** dos 17 steps — **não** um
runtime. O Claude (people-orchestrator) percorre os steps **nesta sessão**:

- `command: speckit.*` → invoca a Skill `/speckit-*` (specify, clarify, plan, tasks,
  implement, analyze).
- `type: gate` → apresenta o gate em **TEXTO PURO** (markdown) e espera `approve` /
  `reject` / `ajustar <o quê>` digitado. **Nunca** `AskUserQuestion` (trava no Warp).
- Citação → `skills_buscar` / `skills_citar` (MCP `acdg-skills`).
- Fato frio de doc de stack → Reference Network (`acdg-ref:ref-elysia|postgresql|nats|authentik`).

Disparo: peça ao `people-orchestrator` para "rodar o pipeline people-context-sdd para
&lt;feature&gt;", ou siga o RUNBOOK (`.smoke-test/RUNBOOK.md`).

## Os 17 steps (RED→YELLOW→GREEN)

```
0  discovery    🚪 requirements-engineer        → specs/<feat>/discovery.md
1  specify      ⚙ /speckit-specify              → spec.md
2  clarify      ⚙ /speckit-clarify
3  review-spec  🚪 requirements-engineer
3.5 recon       🚪 (só extensão) lê a camada-alvo → recon.md
4  domain       🚪 ddd-architect          📚cita → domain.md
5  adr          🚪 software-architect      📚cita → adr/NNNN-*.md
6  metrics      🚪 software-architect      📚cita → metrics.md
7  plan         ⚙ /speckit-plan                 → plan.md (Constitution Check I–X)
8  review-plan  🚪 database-engineer       📚cita
9  bdd          🚪 tdd-strategist               → bdd/*.feature
10 tasks        ⚙ /speckit-tasks                → tasks.md
11 tdd-red 🔴   🚪 tdd-strategist          📚cita → testes W0 que FALHAM (bun test RED)
12 implement    ⚙ /speckit-implement            → W1
13 yellow 🟡    🚪 (bun test verde funcional)
14 review-w2    🚪 clean-code-reviewer     📚cita → review.md APPROVED (máx 3 rounds)
15 analyze      ⚙ /speckit-analyze
16 green 🟢     🚪 /speckit-verify (gate W3 verde)
```

🚪 = gate humano · ⚙ = skill speckit · 📚 = citação canônica obrigatória.

## Gate W3 — `/speckit-verify`

```bash
bun run verify   # = typecheck && format:check && lint && test && coverage (≥95%)
```

Política de **regressão zero**: qualquer vermelho corrige AGORA (Princípio II). O `lint`
falha só em `error` (invariantes duras: no-class, no-any, no-throw em domain/application,
libs proibidas); os `warn` são **dívida de adoção rastreável** que cada ticket deve zerar
no arquivo que tocar.

## Máquina de estado fail-first (tickets)

Cada feature não-trivial abre um ticket em `.pipeline/<TICKET>/STATE.json`:

```bash
bun run pipeline:state init PEO-XYZ --size M       # cria ticket (W0..W3 pending)
bun run pipeline:state wave-start  PEO-XYZ W0 --agent test-writer
bun run pipeline:state wave-finish PEO-XYZ W0 --outcome RED --report 002/REPORT.md
bun run pipeline:state wave-round  PEO-XYZ W2       # +1 round de review
bun run pipeline:state close       PEO-XYZ          # closed-green
bun run pipeline:status                             # dashboard de todos os tickets
bun run pipeline:metrics                            # green rate, review rounds, etc.
```

`STATE.json` é canônico; `STATE.md` é gerado a cada escrita. Tickets fechados são histórico
auditável — **não deletar** (Princípio I).

## Estrutura

```
.specify/
├── memory/constitution.md          # princípios I–X (subordinada ao CLAUDE.md/rules)
├── workflows/people-context-sdd/    # a receita dos 17 steps
├── templates/                       # 13 templates por fase (spec, plan, tasks, domain, adr…)
├── scripts/bash/                    # create-new-feature, common, check-prerequisites (genéricos)
├── extensions/git/                  # hooks de auto-commit / feature branch
└── .smoke-test/RUNBOOK.md           # protocolo de gate (texto puro) + smoke test

.claude/skills/speckit-*/            # skills que executam cada comando do spec-kit
scripts/pipeline/                    # máquina de estado W0→W3 (Bun)
```

## Referências

- **Constitution**: `memory/constitution.md` (princípios I–X).
- **Protocolo de gate (canônico)**: `.smoke-test/RUNBOOK.md` §6.
- **Cânone do serviço** (vence em conflito): `../CLAUDE.md` · `../.claude/rules/`.
- **Origem**: `core-api/.specify/workflows/core-api-sdd/` (v2.1.0).
