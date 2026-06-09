# Métricas & NFRs: [FEATURE]

**Feature**: `specs/[###-feature-name]/` · **Consultores**: `/acdg-skills:software-architect` + `/acdg-skills:requirements-engineer`

> Fase 4 da pipeline `people-context-sdd` (máximo rigor). NFRs ancorados com **citação canônica**
> (Newman/arquitetura) via `skills_citar` — princípio IX. Toda métrica deve ser **mensurável**.

## Métricas funcionais

> "O sistema faz a coisa certa" — verificáveis por teste/BDD.

| ID | Métrica | Alvo | Como medir |
|---|---|---|---|
| MF-001 | [ex: contratos criados com VO válido] | 100% rejeita inválido | teste de domínio |

## Métricas não-funcionais (NFRs)

> "O sistema faz certo" — performance, segurança, auditoria, manutenibilidade.

| ID | Categoria | Alvo mensurável | Como medir |
|---|---|---|---|
| NFR-001 | Performance | [ex: CLI responde < 200ms p/ N=1k] | benchmark CLI |
| NFR-002 | Auditoria | [ex: todo evento vai à outbox] | teste de integração |
| NFR-003 | Segurança | [...] | review/web-security-backend |

**Citação que sustenta os NFRs** (obrigatória):
> [trecho literal ≥4 linhas — `skills_citar`]
> — *(Linha NNNN, p. PP, AUTOR, *LIVRO*)*

## Métricas de performance

| ID | Indicador | Baseline | Alvo | Orçamento |
|---|---|---|---|---|
| MP-001 | latência p95 | [atual/N/A] | [alvo] | [limite] |
| MP-002 | throughput | [...] | [...] | [...] |

> Borda HTTP é Fase 2+ (ADR). Em Fase 1, medir na CLI / casos de uso.

## Critérios de sucesso (mensuráveis, tech-agnostic)

- **SC-001**: [ex: P.O. cria um contrato válido pela CLI em < 2 min].
- **SC-002**: [métrica de negócio].

## Observabilidade

[Como cada métrica será observada em runtime (logs estruturados, contadores). Referencie
OpenTelemetry se aplicável.]
