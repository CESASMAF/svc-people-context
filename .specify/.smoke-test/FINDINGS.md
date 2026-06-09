# Smoke test `people-context-sdd` v2.0.0 — Achados consolidados

**Data**: 2026-06-05 · **Cobaia**: `CTR-LIST-EXPIRING-SOON` (feature descartável, `specs/001-list-expiring-soon/`)
**Resultado**: steps **0→10 percorridos**; encerrado por decisão (opção B) no step 10 — objetivo era
**lapidar a maquinaria**, não entregar a feature. Implementação (steps 11–16) vira ticket próprio,
modelado já com o código em mãos (ver achado #6).

## Pré-requisitos validados

- MCP `acdg-skills` ✓ connected — `skills_buscar`/`skills_citar` retornaram matches reais com grounding
  verificado em 5 pontos (requirements/INVEST, ddd/Specification×2, architecture/Newman, requirements/NFR,
  database/PostgreSQL-index). A citação canônica obrigatória **funciona**.
- CLI `specify` 0.8.19.dev0; workflow `people-context-sdd` v2.0.0 resolvido (17 steps).

## Achados de fricção e correções

| #   | Achado                                                                                                                                                                                                                                                                                                                   | Correção / decisão                                                                                                                                                                                                                              | Gravado em                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Gate como texto solto não dá contexto; o widget `AskUserQuestion` **trava no terminal Warp**                                                                                                                                                                                                                             | Gate = **texto puro markdown** (cabeçalho + resumo + "Próximo se aprovar") + **resposta digitada** (`approve`/`reject`/`ajustar`)                                                                                                               | RUNBOOK §6 · `workflow.yml` · memória |
| 2   | `GateStep` do specify é **TTY-only** (`if not sys.stdin.isatty(): PAUSED`); pty via `script(1)` aborta                                                                                                                                                                                                                   | Agente não dirige o gate do engine; a decisão vive no diálogo (Option 2)                                                                                                                                                                        | RUNBOOK §1                            |
| 3   | `command` step **spawna `claude -p` headless** (`dispatch_command`) — claude aninhado, sem o MCP                                                                                                                                                                                                                         | **Option 2**: Claude orquestra **in-session** (Skills `/speckit-*` aqui), `workflow.yml` = **receita**, não runtime                                                                                                                             | RUNBOOK §1 · `workflow.yml` · memória |
| 4   | `before_specify` tem hook **mandatório** `git.feature` que cria branch — conflita com discovery (step 0, que já precisa da pasta) e com reuso de feature                                                                                                                                                                 | ✅ **CORRIGIDO**: passo de SCAFFOLD documentado ANTES do step 0 no `workflow.yml`; hook `git.feature` → `optional: true` (allow-existing/no-op) no `extensions.yml`                                                                             | `workflow.yml` · `extensions.yml`     |
| 5   | ~~`review-spec` espera seção "Impacto Arquitetural (people-context)" que o template não gera~~                                                                                                                                                                                                                                 | ❌ **FALSO POSITIVO** — o `spec-template.md` JÁ tem a seção (linhas 120–134). O erro foi meu: li só o topo do template e **sobrescrevi** o `spec.md` inteiro em vez de preenchê-lo no lugar. **Lição:** preencher o template, não sobrescrever. | (nada a fazer no template)            |
| 6   | **Domain/ADR/metrics (steps 4–6) acontecem ANTES do grounding no código existente (só no step 10)** → para features que **estendem** código, o modelo diverge do padrão real (ex.: VO `ExpiryWindowDays` vs `expiringWithinDays?: number` primitivo na query, validado na borda — padrão CTR-HTTP-CONTRACT-LIST-FILTERS) | ✅ **CORRIGIDO**: novo gate `recon` (FASE 1.5) ANTES do `domain` no `workflow.yml` — lê o módulo-alvo e grava `recon.md` (greenfield aprova com "N/A")                                                                                          | `workflow.yml`                        |

## Decisões estruturais tomadas

- **Orquestração — Option 2** (achados #2/#3): Claude executa cada step in-session; `command:speckit.*`
  → Skill `/speckit-*`; `type:gate` → texto puro; citação → `skills_buscar`/`skills_citar`; tdd-red/green
  → `.pipeline/` W0→W3. O `specify workflow run/resume` **não** é o executor.
- **Protocolo de gate — texto puro** (achado #1): nunca usar `AskUserQuestion` (trava no Warp).

## Artefatos produzidos (úteis como insumo do ticket real)

`specs/001-list-expiring-soon/`: `discovery.md` · `spec.md` (+ `checklists/requirements.md`) · `domain.md`
· `adr/0001-*.md` · `metrics.md` · `plan.md` (com Review do Plano) · `bdd/list-expiring-soon.feature`.
Cada decisão-chave tem citação canônica literal (Evans, Newman, IIBA/IEEE, PostgreSQL 8.4 Refman).

> ⚠️ O `domain.md`/ADR refletem o modelo **antes** do grounding (achado #6). Ao abrir o ticket real,
> reconciliar com o padrão existente (primitivo na query + validação de borda) antes de implementar.

## Pendências de melhoria da receita (próximos passos)

1. ✅ **FEITO** — recon antes do domain (achado #6): gate `recon` (FASE 1.5) no `workflow.yml`.
2. ❌ **VOID** — achado #5 era falso positivo; o `spec-template.md` já tem a seção. Nada a fazer.
3. ✅ **FEITO** — conflito `before_specify` (achado #4): scaffold antes do step 0 + `git.feature` optional.
4. ⏳ **ABERTO** — decidir o destino da branch `001-list-expiring-soon` (manter como referência ou rollback via §5).

> Os steps da receita agora são **18** (inseriu-se `recon` entre `review-spec` e `domain`).
