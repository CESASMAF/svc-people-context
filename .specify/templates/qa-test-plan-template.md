# Plano de Testes / QA: [FEATURE]

**Feature**: `specs/[###-feature-name]/` · **Consultores**: `/acdg-skills:tdd-strategist` + `/acdg-skills:requirements-engineer`

> Plano de QA da pipeline `people-context-sdd`. Ancorado em **Agile Testing Condensed** (Gregory &
> Crispin) — agora no corpus (domínio `tdd`). Decisões de estratégia exigem **citação canônica
> ≥4 linhas** via `skills_citar` (princípio IX). Complementa o `tdd-template.md` (test list/RED):
> aqui é o **plano amplo de QA**; lá, os testes unitários do ciclo RED→GREEN.

## 1. Contexto (Agile Testing — Cap. 3)

> "Para planejar atividades de teste eficazmente, um time precisa considerar seu contexto":
> **time**, **produto** e **níveis de detalhe**.

- **Time**: [co-localizado / distribuído? especialistas (perf/segurança) disponíveis?]
- **Produto**: [nível de qualidade exigido — ex.: CMS interno ≠ software médico]
- **Níveis de detalhe**: [release / feature / story / task]

**Citação que sustenta a abordagem de planejamento** (obrigatória):
> [trecho literal ≥4 linhas — `skills_citar` em `agile-testing-condensed--gregory-crispin.md`]
> — *(Linha NNNN, p. ?, Janet Gregory, Lisa Crispin, *Agile Testing Condensed*)*

## 2. Estratégia por quadrantes (Agile Testing Quadrants)

| Quadrante | Foco | Nesta feature |
|---|---|---|
| **Q1** tecnologia ⋅ apoia o time | unit, component, integração (TDD) | [testes `*.test.ts` — ver tdd-template] |
| **Q2** negócio ⋅ apoia o time | testes de aceitação, exemplos (BDD) | [cenários `*.feature` — ver bdd-template] |
| **Q3** negócio ⋅ critica o produto | exploratório, usabilidade, UAT | [sessões exploratórias na CLI] |
| **Q4** tecnologia ⋅ critica o produto | performance, segurança, confiabilidade | [ver metrics.md NFRs; web-security-backend] |

## 3. Escopo

- **Em escopo**: [o que será testado]
- **Fora de escopo**: [o que não será — e por quê]

## 4. Pirâmide de testes (Vocke/Fowler)

- Distribuição alvo: muitos unit (domínio puro), menos integração (postgres.js/PostgreSQL), poucos E2E/CLI.
- **Citação** (obrigatória): > [≥4 linhas — `practical-test-pyramid--vocke.md`] — *(Linha NNNN, Ham Vocke)*

## 5. Níveis, tipos e ferramentas

| Nível | Tipo | Ferramenta | Gate |
|---|---|---|---|
| Domínio | unit (puro) | `bun:test` (`bun test`) | W3 |
| Application | use case (fakes) | `bun:test` | W3 |
| Integração | persistência/outbox | `bun run test:integration` (PostgreSQL) | pré-merge |
| Aceitação | BDD Gherkin | mapeado em bdd/ | review |

## 6. Critérios de entrada e saída (Definition of Done)

- **Entrada**: BDD aprovado; testes RED escritos (🔴).
- **Saída (GREEN 🟢)**: todos verdes + W3 (`/speckit-verify`) + review W2 + citações registradas + regressão zero (Princ. II).

## 7. Riscos de qualidade

| Risco | Probab. | Impacto | Mitigação (teste) |
|---|---|---|---|
| [ex: invariante de Cpf (mod-11)] | [...] | [...] | [teste de domínio dedicado] |

## 8. Ambiente e dados de teste

- **Ambiente**: [memory driver (default) / PostgreSQL via Docker para integração]
- **Dados**: [mínimos e significativos — Kent Beck: "se não há diferença conceitual entre 1 e 2, use 1"]

## 9. Papéis (whole-team approach)

[Quem faz o quê — Agile Testing: qualidade é responsabilidade do time todo, não de um silo de QA.]
