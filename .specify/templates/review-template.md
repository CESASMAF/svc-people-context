# Review W2 (🟡→🟢): [FEATURE]

**Feature**: `specs/[###-feature-name]/` · **Ticket**: `[CTR-...]` · **Round**: [1/3]
**Consultores**: `/acdg-skills:clean-code-reviewer` (+ `/acdg-skills:security-reviewer` se houver superfície sensível)

> Fase 9 da pipeline `people-context-sdd` (máximo rigor). Audit **read-only** do código de W1.
> Achados ancorados com **citação canônica** (Uncle Bob/Fowler/Valente; OWASP p/ segurança) via
> `skills_citar` — princípio IX. Máx. 3 rounds antes de escalar.

## Veredito

**[ APPROVED | REJECTED ]**

## Issues

| # | Severidade | Arquivo:linha | Problema | Citação (regra) | Sugestão |
|---|---|---|---|---|---|
| 1 | [blocker/major/minor] | `src/...:NN` | [code smell / violação] | [`skills_citar` → autor/livro] | [refactor] |

**Citação de um achado relevante** (literal ≥4 linhas):
> [trecho do livro]
> — *(Linha NNNN, p. PP, AUTOR, *LIVRO*)*

## Checklist (princípios da constituição)

- [ ] Domínio puro: sem classes/throw; `Result<T,E>`; branded types (Princ. V)
- [ ] Import boundary: domain sem deps externas, application via ports, cross-layer respeita a fronteira (Princ. IV)
- [ ] TS strict: sem `any`, `import type`, extensões `.ts` (Princ. VIII)
- [ ] Idioma: código EN, mensagens PT (Princ. VIII)
- [ ] Sem `npm`; migrations via `db:generate` (Princ. III, VI)
- [ ] Segurança (se aplicável): sem secret vazado, input validado na borda

## Decisão

- **APPROVED** → seguir para o gate W3 (GREEN).
- **REJECTED** → endereçar issues (round++); regressão zero (Princ. II). Round 3 esgotado → escalar ao humano.
