---
name: "speckit-verify"
description: "Quality gate W3 do people-context: roda typecheck + format:check + lint + test + coverage (≥95%) e aplica a política de regressão zero antes de finalizar uma feature do spec-kit."
argument-hint: "(sem argumentos) — roda o gate completo no estado atual"
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "acdg / people-context"
  source: "custom (não faz parte do bundle oficial do spec-kit)"
user-invocable: true
disable-model-invocation: false
---

## Objetivo

Etapa de verificação **custom** do fluxo spec-kit do `people-context`. Materializa o
**gate W3** e a **política de regressão zero** da constituição (Princípios I e II) como
uma etapa executável, invocável manualmente (`/speckit-verify`) ou automaticamente via
hook `after_implement` em `.specify/extensions.yml`.

> É a versão **completa** da skill `quality-gate` existente: aquela cobre typecheck →
> test → coverage; esta acrescenta `format:check` + `lint` (gate de qualidade trazido do
> core-api). As regras canônicas vivem em `CLAUDE.md` e `.claude/rules/`; aqui só as
> aplicamos. Esta skill é **custom** — updates do CLI do spec-kit **não** a sobrescrevem.

## Execução

Rode o gate W3 completo, **em ordem**, parando para corrigir ao primeiro vermelho:

```bash
bun run typecheck      # tsc --noEmit (strict)
bun run format:check   # prettier --check .
bun run lint           # eslint . (typescript-eslint strict+stylistic; falha só em `error`)
bun test               # bun:test — tests/**/*.test.ts
bun run coverage       # bun test --coverage | scripts/check-coverage.js (≥95% linhas)
```

> **Sobre o `lint`:** o gate falha apenas em `error` (invariantes duras: `no-class`,
> `no-any`, `no-throw` em domain/application, libs proibidas). Os `warn` são **dívida de
> adoção rastreável** (`strict-boolean-expressions` etc.) — não travam o gate, mas todo
> ticket que toca um arquivo deve **zerar os warns daquele arquivo** (Princípio IX).
> Conferir a contagem de warnings não aumentou: `bun run lint 2>&1 | tail -1`.

Se a feature alterou o schema, confirme que a migration foi adicionada à mão em
`src/repository/migrations.ts` (sequencial, idempotente) e que `bun test` cobre o caminho.

## Política de regressão zero (Princípio II — invariante)

**Qualquer vermelho é regressão a corrigir AGORA**, tenha ou não sido causado pelo diff
atual. "Não é meu erro" / "já estava quebrado" **não** encerram a etapa. Diante de uma
falha, exatamente uma destas saídas é aceitável:

1. **Consertar a causa** — o código/teste volta ao verde de verdade.
2. **Corrigir o gate mal-gateado** e **provar** o verde no caminho correto. Nunca
   esconder atrás de `skip`/`eslint-disable` sem provar que o teste/regra passa no lugar dele.
3. **Escalar ao humano** com diagnóstico de causa-raiz — só quando 1 e 2 estão fora do
   escopo, e sempre explícito.

Fechar o gate com vermelho não-endereçado é o anti-padrão mais grave do pipeline.

## Saída

Ao final, reporte de forma concisa:

- ✅ **Verde**: liste os 5 comandos que passaram (typecheck, format:check, lint, test, coverage)
  + a contagem de warnings de lint (que não deve ter subido).
- ⚠️ **Vermelho endereçado**: o que falhou e como foi corrigido (causa-raiz).
- 🚩 **Escalado**: o que não foi possível resolver e por quê, com diagnóstico.

Não declare a feature pronta enquanto o gate não estiver verde de verdade.
