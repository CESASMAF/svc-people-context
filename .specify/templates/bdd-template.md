# BDD: [FEATURE]

**Feature**: `specs/[###-feature-name]/` · **Consultores**: `/acdg-skills:requirements-engineer` + `/acdg-skills:tdd-strategist`

> Fase 6 da pipeline `people-context-sdd`. Cenários Given-When-Then derivados dos critérios de
> aceitação (descoberta/spec). Cada cenário vira teste na fase 7 (TDD/RED). Idioma: PT
> (negócio); identificadores no código permanecem EN. Grave os `.feature` em `specs/<feature>/bdd/`.

## Cobertura

| História (US) | Cenário(s) | Prioridade |
|---|---|---|
| US-001 | CT-001, CT-002 | P1 |

---

```gherkin
# language: pt
Funcionalidade: [nome da capacidade de negócio]
  Como [papel]
  Quero [ação]
  Para [benefício]

  Contexto:
    Dado que [pré-condição comum a todos os cenários]

  # CT-001 — caminho feliz (P1)
  Cenário: [título claro do comportamento]
    Dado [estado inicial]
    Quando [ação do usuário/sistema]
    Então [resultado observável]
    E [efeito colateral verificável — ex: evento na outbox]

  # CT-002 — regra de negócio / borda
  Cenário: [violação de invariante]
    Dado [estado]
    Quando [ação inválida]
    Então [erro esperado — string-literal union EN, ex: 'contract-not-active']

  # CT-003 — variações tabeladas
  Esquema do Cenário: [comportamento parametrizado]
    Dado um valor "<entrada>"
    Quando processado
    Então o resultado é "<esperado>"

    Exemplos:
      | entrada | esperado |
      | [...]   | [...]    |
```

## Mapeamento BDD → testes (preenchido na fase 7/TDD)

| Cenário | Arquivo de teste | Nível (domínio/app/integração) |
|---|---|---|
| CT-001 | `tests/.../*.test.ts` | [a definir] |
