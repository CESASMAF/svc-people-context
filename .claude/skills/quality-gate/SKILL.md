---
name: quality-gate
description: Gate antes de fechar PR — roda typecheck → format:check → lint → test → coverage (≥95%) e reporta ALL GREEN ou BLOCKED com saída literal
user-invocable: true
allowed-tools: Bash(bun *), Bash(bunx *), Read, Glob, Grep
---

# quality-gate

Valida a saúde do repositório `people-context` antes de qualquer merge. Executa na ordem exata abaixo e para no primeiro bloqueio — não pula etapas.

> Atalho: `bun run verify` roda os 5 passos encadeados.

## Pré-condição

Confirme que `package.json` existe e tem os scripts reais:

```
bun run typecheck     → tsc --noEmit
bun run format:check  → prettier --check .
bun run lint          → eslint .
bun test              → bun test
bun run coverage      → bun test --coverage 2>&1 | tee /dev/stderr | bun scripts/check-coverage.js
```

Se algum script estiver ausente, reporte `⚠️ PENDENTE — script não encontrado` para essa etapa e continue com as demais.

---

## Passo 1 — TypeScript typecheck

```bash
bun run typecheck
```

- Saída esperada: nenhum erro de tipo (exit 0).
- Cole a saída literal.
- Falhou? → status **BLOCKED (typecheck)**. Não avance.

---

## Passo 2 — Formatação (Prettier)

```bash
bun run format:check
```

- Saída esperada: "All matched files use Prettier code style!" (exit 0).
- Falhou? → status **BLOCKED (format)**. Corrija com `bun run format`. Não avance.

---

## Passo 3 — Lint (ESLint)

```bash
bun run lint
```

- Saída esperada: **0 errors** (exit 0). `warning`s são dívida de adoção e **não** bloqueiam,
  mas **não podem aumentar** — confira a última linha (`✖ N problems (0 errors, M warnings)`).
- Falhou (≥1 error)? → status **BLOCKED (lint)**. Corrija a causa (nunca `eslint-disable` sem
  prova). Não avance.

---

## Passo 4 — Testes unitários

```bash
bun test
```

- Todos os testes devem passar (exit 0).
- Cole a saída literal (número de testes passando/falhando).
- Falhou? → status **BLOCKED (test)**. Não avance.

---

## Passo 5 — Cobertura de linhas ≥ 95%

```bash
bun run coverage
```

- O script `scripts/check-coverage.js` lê a linha `All files | <funcs>% | <lines>%` do output do `bun test --coverage` e verifica se `lines ≥ 95`.
- Cole a saída literal incluindo a última linha do script (`Line coverage XX.XX% meets/is below...`).
- Abaixo de 95%? → status **BLOCKED (coverage)**. Liste quais arquivos estão abaixo.

---

## Resultado

### ALL GREEN

```
✅ typecheck    — OK
✅ format:check — OK
✅ lint         — 0 errors (M warnings de dívida, estável)
✅ test         — N testes passaram
✅ coverage     — XX.XX% ≥ 95%

ALL GREEN — pronto para PR.
```

### BLOCKED

```
❌ <etapa> — BLOCKED
Saída literal:
<cole aqui o output do comando>

Demais etapas: [executadas / não executadas por bloqueio anterior]
```

Nunca marque como verde algo que não executou ou que retornou exit ≠ 0.
