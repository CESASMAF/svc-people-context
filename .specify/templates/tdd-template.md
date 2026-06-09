# Plano de TDD (RED 🔴): [FEATURE]

**Feature**: `specs/[###-feature-name]/` · **Consultor**: `/acdg-skills:tdd-strategist` · **Ticket**: `[CTR-...]`

> Fase 7 da pipeline `people-context-sdd` (máximo rigor). Ancorado em Kent Beck (TDD) — **citação
> obrigatória** via `skills_citar` (princípio IX). Os testes são escritos ANTES da implementação
> (W0) e DEVEM falhar por inexistência da API. Runner: `bun:test` (`bun test`); integração
> atrás de `bun run test:integration`.

## Estratégia

- **Estilo**: [Detroit/classicista (default no domínio puro) | London/mockist (na borda)] — justifique.
- **Níveis**: domínio (VOs/agregados, puro) · application (use cases, ports fakes) · integração (postgres.js/PostgreSQL).
- **Citação que sustenta a estratégia** (obrigatória):
  > [trecho literal ≥4 linhas — `skills_citar`, Kent Beck]
  > — *(Linha NNNN, p. PP, Kent Beck, *TDD*)*

## Test list (Kent Beck)

> Lista viva do que precisa ser testado. Marque conforme RED→GREEN.

- [ ] T-001 — [comportamento] ← CT-001 (BDD) — nível: domínio
- [ ] T-002 — [invariante/erro] ← CT-002 — nível: domínio
- [ ] T-003 — [orquestração] ← CT-003 — nível: application
- [ ] T-004 — [persistência/outbox] — nível: integração (`*_INTEGRATION=1`)

## Mapeamento BDD → teste

| Cenário (BDD) | Teste | Arquivo | Nível |
|---|---|---|---|
| CT-001 | T-001 | `tests/.../*.test.ts` | domínio |

## Ordem RED (primeiro teste a falhar)

1. [T-00X — o teste mais simples que força a 1ª decisão de design]
2. ...

## Confirmação RED 🔴

```bash
bun test          # deve FALHAR — API ainda não existe
```

- [ ] Todos os testes da lista existem e **falham pelo motivo certo** (inexistência da API),
      não por erro de compilação/typo.
- [ ] Ticket aberto: `bun run pipeline:state init <ticket> --size <S|M|L>`; W0 registrado.

> Próxima fase: implementação mínima (W1) até 🟡 YELLOW (testes passam).
