# Descoberta: [FEATURE]

**Feature**: `specs/[###-feature-name]/` · **Consultor**: `/acdg-skills:requirements-engineer`

> Fase 0 da pipeline `people-context-sdd`. Elicitação ancorada em Gerenciamento de Requisitos
> (Moraes & Lopes) + Histórias de Usuário. Saída alimenta a SPEC (fase 1).

## Problema / Oportunidade

[Qual dor/necessidade do negócio motiva esta feature? Em 2-4 frases, sem solução técnica.]

## Stakeholders

| Stakeholder | Interesse / o que espera | Decisor? |
|---|---|---|
| [ex: P.O.] | [...] | sim/não |

## Histórias de usuário (INVEST)

<!-- Independent, Negotiable, Valuable, Estimable, Small, Testable -->

- **US-001** (P1): Como [papel], quero [ação], para [benefício].
  - **Valor / prioridade**: [por que P1]
  - **Critérios de aceitação** (viram BDD na fase 6): dado [estado], quando [ação], então [resultado].
- **US-002** (P2): ...

## Requisitos

### Funcionais
- **RF-001**: O sistema DEVE [capacidade verificável].

### Não-funcionais (viram métricas na fase 4)
- **RNF-001**: [performance / segurança / auditoria / disponibilidade] — [alvo qualitativo].

## Restrições e premissas

- [Restrições do people-context: camadas funcionais (no-class), PostgreSQL 15, HTTP-first (Elysia), bun…]
- [Premissas assumidas quando o pedido foi vago.]

## Fora de escopo

- [O que esta feature explicitamente NÃO faz.]

## Rastreabilidade (inicial)

| Requisito | História | Critério → BDD | Teste (TDD) |
|---|---|---|---|
| RF-001 | US-001 | [cenário] | [a definir na fase 7] |

## Perguntas em aberto

- [ ] [NEEDS CLARIFICATION: ...] → resolver na fase de clarificação (`/speckit-clarify`).
