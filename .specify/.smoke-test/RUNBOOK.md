# Smoke test da pipeline `people-context-sdd` v1.0.0 — RUNBOOK

> **Objetivo:** validar a pipeline spec-driven de ponta a ponta (17 steps / RED→YELLOW→GREEN),
> com o MCP `acdg-skills` conectado (personas + citação canônica), numa feature real pequena.
> **Cobaia:** `PEO-LIST-BY-ROLE` — "Listar contratos a vencer em N dias" (input em `SPEC-INPUT.txt`).
> **Critério:** sucesso é a _maquinaria_ percorrer os 17 steps sem travar e o gate W3 fechar verde,
> **não** a perfeição da feature. Anotar toda fricção (ver §4).

---

## 0. Pré-requisitos (uma vez)

1. **Docker Desktop rodando** (o `.mcp.json` sobe o server via `docker run --rm -i`).
2. Abrir o Claude Code **dentro de `people-context/`** (não na raiz do mono_repo — o `.mcp.json` é por projeto):
   ```bash
   cd people-context && claude
   ```
3. **Aprovar o opt-in do MCP** `acdg-skills` quando perguntado (ou `/mcp` → habilitar).
4. **Confirmar conexão:** `/mcp` deve listar `acdg-skills` ✓ connected; testar `/acdg-skills:ddd-architect`.
   - Estado validado por stdio em 2026-06-05: 3 tools (`skills_buscar/citar/cross_ref`) + 18 prompts.
5. `bun install` em dia; `git status` limpo na branch de trabalho (criar branch p/ a feature).

> ⚠️ Sem os passos 2–4 os gates `domain`, `adr`, `metrics`, `tdd-red` e `review-w2` **não podem**
> cumprir a citação obrigatória (≥4 linhas via `skills_citar`). A pipeline aborta no gate.

---

## 1. Modelo de orquestração (DECISÃO — achados #2/#3)

**O Claude orquestra a pipeline IN-SESSION; o `workflow.yml` é a RECEITA dos 17 steps, não o runtime.**
Investigação do engine `specify` (2026-06-05) mostrou dois conflitos com "Claude conduzindo":

- **#2 — gate é TTY-only** (`steps/gate/__init__.py`: `if not sys.stdin.isatty(): return PAUSED`). O agente,
  em Bash não-TTY, nunca avança um gate; um pty via `script(1)` cai no default `reject` e aborta.
- **#3 — command spawna `claude -p` headless** (`integrations/base.py:dispatch_command` →
  `subprocess.run([claude, "-p", …])`): seria um `claude` aninhado, sem o contexto/MCP desta sessão →
  rigor de citação (acdg-skills) não garantido.

Por isso **NÃO** se usa `specify workflow run` como executor. Em vez disso:

| Step da receita      | Como o Claude executa in-session                                                  |
| -------------------- | --------------------------------------------------------------------------------- |
| `command: speckit.*` | invoca a Skill `/speckit-*` **nesta sessão** (MCP `acdg-skills` ativo)            |
| `type: gate`         | apresenta um **gate em TEXTO PURO** (protocolo §6); approve → segue, reject → para |
| citação obrigatória  | `skills_buscar`/`skills_citar` do MCP, aqui mesmo                                 |
| tdd-red / green      | usa o pipeline `.pipeline/<TICKET>/` W0→W3 que já existe                  |

Os artefatos vão para `specs/001-list-expiring-soon/` (a receita, §2, diz qual artefato por step).
O `specify workflow run/resume/status` fica como **doc/recibo opcional**, não como motor.

---

## 2. Os 17 steps — o que cada gate espera + persona ACDG

| #   | Step         | Tipo | Persona / comando                                           | Artefato                                   |    Citação?     |
| --- | ------------ | ---- | ----------------------------------------------------------- | ------------------------------------------ | :-------------: |
| S   | scaffold     | —    | `create-new-feature.sh` (achado #4)                         | branch + `specs/<feat>/` (antes do step 0) |        —        |
| 0   | discovery    | gate | `/acdg-skills:requirements-engineer`                        | `specs/<feat>/discovery.md`                |        —        |
| 1   | specify      | cmd  | `/speckit-specify`                                          | `spec.md`                                  |        —        |
| 2   | clarify      | cmd  | `/speckit-clarify`                                          | atualiza `spec.md`                         |        —        |
| 3   | review-spec  | gate | `/acdg-skills:requirements-engineer`                        | revisa INVEST + "Impacto Arquitetural"     |        —        |
| 3.5 | recon        | gate | leitura do módulo-alvo (achado #6 — só extensão)            | `recon.md` (ou "N/A — greenfield")         |        —        |
| 4   | domain       | gate | `/acdg-skills:ddd-architect`                                | `domain.md` (BCs, agregados, VOs)          | ✅ Evans/Vernon |
| 5   | adr          | gate | `/acdg-skills:software-architect`                           | `adr/NNNN-*.md`                            |       ✅        |
| 6   | metrics      | gate | `software-architect` + `requirements-engineer`              | `metrics.md` (NFRs mensuráveis)            |       ✅        |
| 7   | plan         | cmd  | `/speckit-plan`                                             | `plan.md` (Constitution Check I–IX)        |        —        |
| 8   | review-plan  | gate | `/acdg-skills:database-engineer`                            | confere Migrations postgres.js + estimativa W0 |   ✅ (schema)   |
| 9   | bdd          | gate | `requirements-engineer` + `tdd-strategist`                  | `bdd/*.feature` (Given-When-Then)          |        —        |
| 10  | tasks        | cmd  | `/speckit-tasks`                                            | `tasks.md`                                 |        —        |
| 11  | tdd-red 🔴   | gate | `/acdg-skills:tdd-strategist`                               | testes W0 que FALHAM; `bun test` RED      |  ✅ Kent Beck   |
| 12  | implement 🟡 | cmd  | `/speckit-implement`                                        | impl mínima W1                             |        —        |
| 13  | yellow 🟡    | gate | —                                                           | `bun test` verde funcional                |        —        |
| 14  | review-w2    | gate | `/acdg-skills:clean-code-reviewer` (+ security se sensível) | `review.md` APPROVED                       |  ✅ Uncle Bob   |
| 15  | analyze      | cmd  | `/speckit-analyze`                                          | consistência cross-artefato                |        —        |
| 16  | green 🟢     | gate | `/speckit-verify` (W3)                                      | typecheck+format+lint+test verdes          |        —        |

**No step 11 (tdd-red)**, antes de escrever os testes, abrir o ticket de pipeline:

```bash
bun run pipeline:state init PEO-LIST-BY-ROLE --size S
```

---

## 3. Pontos de citação obrigatória (≥4 linhas via `skills_citar`)

`domain` (4) · `adr` (5) · `metrics` (6) · `review-plan` (8, schema) · `tdd-red` (11) · `review-w2` (14).
Cada decisão-chave registra a citação literal no artefato correspondente. Use `skills_buscar` para
achar o trecho e `skills_citar` para extrair com linha/página/autor/livro.

---

## 4. O que observar e anotar (é isto que o smoke test mede)

- [ ] O `specify workflow run` resolve a **v1.0.0** (17 steps) — não a antiga.
- [ ] Cada step `command: speckit.*` realmente aciona a skill certa.
- [ ] Os gates pausam e aceitam approve/reject como esperado; `reject` aborta limpo.
- [ ] As personas `/acdg-skills:*` respondem (MCP conectado) em cada gate de rigor.
- [ ] `skills_buscar`/`skills_citar` retornam citações reais (sem timeout/erro do container).
- [ ] `bun test` fica **RED** no step 11 pelo motivo certo (API inexistente), e **verde** no 13.
- [ ] `/speckit-verify` (W3) fecha **tudo verde** no step 16.
- [ ] Os artefatos `specs/<feat>/*` são gerados com os campos de citação preenchidos.
- [ ] Qualquer travamento da maquinaria (template ausente, path errado, comando que não existe)
      → anotar o step, o erro literal e seguir.

> Resultado do smoke vai para a memória do projeto (`pipeline-sdd-acdg-skills-mcp`), fechando a
> pendência (c). Se a feature ficar boa, vira entrega real; senão, a branch é descartável.

---

## 5. Rollback / limpeza (se for descartar)

```bash
git checkout -- . && git clean -fd specs/ .pipeline/PEO-LIST-BY-ROLE
# e apagar a branch da feature criada pelo speckit-specify
```

---

## 6. Protocolo de gate (CANÔNICO) — como o agente apresenta cada `type: gate`

> **Origem:** achado #1 do smoke test (2026-06-05), **refinado**. Primeira tentativa usou o widget
> `AskUserQuestion` (3 opções + preview) — mas ele **engasga/trava no terminal do Gabriel (Warp)**.
> Decisão final: **gate é TEXTO PURO em markdown + resposta digitada**. Nada de widget.

**Toda pausa `type: gate` é apresentada como uma seção markdown de texto puro, e o humano responde
digitando `approve` / `reject` / `ajustar <o quê>`:**

1. **Cabeçalho** — `## GATE <n>/<total> — <ID-DA-FASE>  (responda: approve / reject / ajustar <o quê>)`.
2. **Contexto** — 2–4 linhas: o que a fase **produziu** (artefato + caminho) e o resumo das decisões/citações.
3. **Resumo estruturado** — bullets/tabela com o conteúdo do artefato (não um bloco monospace de widget).
4. **`Próximo se aprovar:`** — qual o próximo step.

**Mapeamento decisão → ação (sob Option 2 — Claude orquestra in-session, §1):**

| Resposta digitada | Ação do agente                                                         |
| ----------------- | ---------------------------------------------------------------------- |
| `approve`         | executa o próximo step in-session (Skill `/speckit-*` ou próximo gate) |
| `reject`          | **para** (não há engine pra abortar; artefatos ficam pra inspeção/§5)  |
| `ajustar <X>`     | edita o artefato conforme pedido e **reapresenta o mesmo gate**        |

**Invariantes:** PT-BR com acentuação completa · **NUNCA usar `AskUserQuestion`/widget** (trava no Warp) ·
gate sempre como markdown legível · esperar a resposta digitada antes de avançar.
