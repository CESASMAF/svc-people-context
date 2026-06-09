---
name: add-endpoint
description: Receita ponta-a-ponta para adicionar um endpoint Elysia — domain → repository → events → routes → tests → contracts → quality-gate
user-invocable: true
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(bun *), Skill
---

# add-endpoint

Guia canônico para adicionar um endpoint no `people-context` sem violar camadas, segurança ou LGPD. Siga a ordem. Cada passo tem um expert responsável — delegate um por vez (não paralelize).

> **Antes de começar:** leia `contracts/services/people/` (OpenAPI 3.1 / AsyncAPI 3.1). O contrato é a fonte de verdade da API e dos eventos. Se o novo endpoint muda o contrato, isso é uma decisão — sinalize antes de implementar.

---

## Passo 1 — domain/ (validação e tipos)

**Expert:** `functional-domain-expert`

1. Identifique se o endpoint precisa de um novo Branded Type (novo ID, VO validado). Se sim, adicione em `domain/` com smart constructor retornando `T | null`.
2. Crie ou atualize a função `validateXxx(input: unknown): ValidationResult` onde:
   ```ts
   type ValidationResult =
     | { readonly kind: "ok" }
     | { readonly kind: "error"; readonly message: string }
   ```
3. Lembre: `domain/` tem **zero dependências externas**. Nenhum import de `repository/`, `events/`, `elysia`, `postgres`.
4. Proibido: `class`, `any`, `throw`, SQL.
5. Se CPF envolver — nunca retorne CPF cru em evento; valide mod-11 com `toCpf()`.

---

## Passo 2 — repository/ (SQL e migrations)

**Expert:** `repository-expert`

1. Adicione o método novo na interface do repositório (shape puro, sem implementação).
2. Implemente via factory DI:
   ```ts
   const createPersonRepository = (sql: Sql): PersonRepository => ({
     novoMetodo: async (input) => { /* sql`...${value}...` */ },
   });
   ```
3. **SQL 100% parametrizado** via tagged template `sql\`...\``. Nunca concatenar.
4. Se o schema muda (nova coluna, tabela, índice):
   - Crie migration numerada `v<N+1>` em `repository/migrations.ts`, idempotente (`IF NOT EXISTS` / `IF EXISTS`).
   - Cada migration roda em transação.
   - Verifique o número da última migration antes de escolher `N+1`.
5. Nomes de tabela/coluna: `snake_case` minúsculo.
6. Dúvida sobre tipos Postgres, índices ou GUCs → consulte `ref-postgresql`.

---

## Passo 3 — events/ (Outbox, somente se houver mudança de estado)

**Expert:** `events-outbox-expert`

Só execute este passo se o endpoint **muta estado** que outros serviços precisam saber.

1. Adicione o builder do novo evento em `events/publisher.ts`:
   ```ts
   const buildXxxEvent = (data: XxxEventData): OutboxEvent => ({ ... });
   ```
2. Subject obrigatório: `people.<entity>.<action>` (ex: `people.person.created`, `people.role.assigned`).
3. **CPF NUNCA entra no payload do evento** (LGPD HIGH-8). Use `fullName`, `birthDate`, ids — nunca `cpf`.
4. Password reset link viaja **somente** no evento `people.user.password_reset_requested` — nunca no response HTTP (ADR-030, AppSec CRITICAL-2).
5. Grave no Outbox via `publisher.ts`. Nunca use `nc.publish` direto na rota.
6. Dúvida sobre subjects, consumers, ack → consulte `ref-nats`.

---

## Passo 4 — routes/ (handler Elysia magro)

**Expert:** `elysia-http-expert`

O handler é magro: valida entrada, chama repository/application, monta envelope. Sem lógica de negócio.

1. Adicione a rota no arquivo correto de `routes/` (ou crie novo se bounded context diferente).
2. Estrutura canônica:
   ```ts
   app.post("/people/:id/xxx", async ({ params, body, headers, set }) => {
     // 1. AuthZ
     const guard = guardRequest(headers, ["admin", "superadmin"]);
     if (!guard.ok) return errorResponse(set, guard.code, guard.message);

     // 2. Validação TypeBox (t)
     // (use schema TypeBox no .use(validator) do plugin ou inline)

     // 3. Validação de domínio
     const validation = validateXxx(body);
     if (validation.kind === "error") return errorResponse(set, "PEO-XXX", validation.message);

     // 4. Repository / Application
     const result = await repo.novoMetodo(input);
     if (!result) return errorResponse(set, "PEO-XXX", "Not found");

     // 5. Outbox (se necessário)
     await publisher.saveXxxEvent(result);

     // 6. Envelope de resposta
     return { data: result, meta: { timestamp: new Date().toISOString() } };
   });
   ```
3. Envelope de sucesso: `{ data, meta: { timestamp } }`.
4. Envelope de erro: `{ success: false, error: { code, message } }`.
5. Novos error codes seguem a série existente: `PEO-XXX` (person), `ROL-XXX` (role), `IDP-XXX` (idp), `AUTH-XXX` (auth). Não reutilize código existente.
6. `X-Actor-Id` obrigatório em POST/PUT/DELETE → senão `AUTH-003`.
7. Erros do Authentik **não vazam** no response — mapear para `IDP-00x` genérico (HIGH-7).
8. Dúvida sobre Elysia handler, TypeBox/`t`, lifecycle → consulte `ref-elysia`.

---

## Passo 5 — tests/ (fakes in-memory, cobertura ≥ 95%)

**Expert:** `test-writer`

1. Crie ou atualize o arquivo de teste em `tests/` correspondente à camada alterada.
2. Use fakes in-memory para repository e publisher (sem banco real, sem NATS real).
3. Casos obrigatórios para cada endpoint:
   - ✅ Sucesso (happy path) — verifica envelope `{data, meta}`.
   - ❌ Validação falhou — verifica `{success:false, error:{code,message}}`.
   - ❌ Sem autorização / role insuficiente — verifica `AUTH-00x` / `ROL-00x`.
   - ❌ Não encontrado — verifica código correto (`PEO-00x` etc.).
4. Testes de domínio são puros (sem I/O): input → `ValidationResult`, casos de borda inclusos.
5. Mantenha cobertura de linhas ≥ 95% (gate em `scripts/check-coverage.js`).
6. Framework: `bun:test` (API compatível com Jest — `describe`, `it`, `expect`).

---

## Passo 6 — contracts/ (OpenAPI / AsyncAPI)

Não é implementação — é anotação/sinalização.

1. Se o endpoint novo ou alterado muda a API pública, anote que `contracts/services/people/openapi.yaml` precisa ser atualizado.
2. Se um novo evento foi adicionado em `events/`, anote que `contracts/services/people/asyncapi.yaml` precisa refletir o novo subject e schema.
3. Os contratos vivem no repo `contracts/` (separado). Sinalize a necessidade — não edite aqui diretamente sem confirmar com o time.

---

## Passo 7 — quality-gate

Execute a skill antes de encerrar:

```
/quality-gate
```

Ou via Skill tool: `{ "skill": "quality-gate" }`.

Resultado esperado: **ALL GREEN**. Se BLOCKED, corrija o que falhou e repita.

---

## Invariantes globais (nunca viole)

| Regra | Origem |
|---|---|
| `class`, `this`, `any`, `enum` proibidos | `.claude/rules/functional-ts.md` |
| CPF nunca em payload de evento | `.claude/rules/security-lgpd.md` (HIGH-8) |
| SQL sempre parametrizado | `.claude/rules/security-lgpd.md` |
| Password reset link só via evento | ADR-030, CRITICAL-2 |
| Erros do IdP não vazam no HTTP | HIGH-7 → mapear `IDP-00x` |
| `actorId = JWT.sub`; `X-Actor-Id` obrigatório em mutações | ADR-023, `security-lgpd.md` |
| Outbox para eventos (nunca `nc.publish` na rota) | `people-orchestrator.md` |
| `throw` só em adapter, convertido a Result no contorno | ADR-014, `functional-ts.md` |

## Reference Network — fatos de doc (não chute)

| Dúvida | Consulte |
|---|---|
| Elysia: handler, `t`/TypeBox, lifecycle, plugin | `subagent_type: "acdg-ref:ref-elysia"` |
| PostgreSQL: tipos, funções, índices, GUCs | `subagent_type: "acdg-ref:ref-postgresql"` |
| NATS/JetStream: subjects, consumers, ack | `subagent_type: "acdg-ref:ref-nats"` |
| Authentik: OIDC/OAuth2, claims, Management API | `subagent_type: "acdg-ref:ref-authentik"` |

Passe a pergunta como texto (o externo não vê o código). `NÃO ENCONTRADO` → não invente; escale.
