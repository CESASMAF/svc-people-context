# W0 (RED / BLOCKED) — T-SQL-NATIVE — migrar postgres.js → Bun.sql

## Decisão: NÃO migrar agora — BLOQUEADO por ausência de oráculo

A migração postgres.js → Bun.sql é **viável e desejável** (reduz 4→3 deps de runtime, é a única
troca que respeita a design rule — o driver vive atrás da factory `createXxxRepository(sql)`).
Porém está **bloqueada** porque o gate (regressão zero, Princípio II) não tem como ser satisfeito.

## Por que: o oráculo de teste NÃO existe para a camada que seria migrada

- Não há `tests/repository/`. `createPersonRepository`/`createRoleRepository`/`createDb` **não são
  importados por nenhum teste** (verificado: `grep -rln createPersonRepository tests/` → vazio).
- Nenhum teste conecta em Postgres real (`grep -rln "postgres://|DATABASE_URL|sql\`SELECT" tests/` → vazio).
- As rotas são testadas com **fakes** (`tests/routes/fake-repositories.ts`) — o SQL real (postgres.js:
  `sql.begin`, `sql.unsafe(WHITELIST)`, tagged templates, `sql.json`, pool) **nunca executa em teste**.
- Os arquivos `src/repository/*.ts` **não aparecem** no relatório de cobertura (não instrumentados,
  pois não são carregados). A cobertura 97.95% é sobre domain/routes/middleware/application — **não**
  sobre a execução real do driver.

Conclusão: trocar o driver e rodar `bun run verify` daria **verde sem validar nada** do que mudou.
Para I/O com dados de saúde (LGPD), isso é inaceitável — typecheck não prova paridade de `sql.begin`/
`sql.unsafe`/`sql.json`/transações entre postgres.js e Bun.sql.

## Diferenças de API a tratar na migração (quando desbloquear)
Toca: `db.ts` (factory `postgres()` → `new SQL()`/`Bun.sql`, config de pool max/idleTimeout),
`person-repository.ts` + `role-repository.ts` (`sql.begin` tx, `sql.unsafe`, tuplas `[T]`),
`migrations.ts` (`sql.begin`), `events/publisher.ts` (`sql.json`). O tipo exportado `Sql` (postgres)
vira o tipo do `Bun.sql` — a interface/ports NÃO mudam (design rule preservada).

## Pré-requisito para desbloquear (ticket próprio, antes da migração)
1. Subir Postgres de teste (`docker compose up postgres -d`) e adicionar service container de Postgres no CI.
2. Escrever **suíte de integração** de repository contra Postgres real: create/findById/findByCpf/
   update/deactivate/reactivate/delete/list + assign-role (tx) + reconcile. **Baseline VERDE com
   postgres.js** = o oráculo.
3. SÓ ENTÃO trocar o driver e exigir a MESMA suíte verde (paridade) + `bun run verify`.

## Status
Aberto/bloqueado. Não fechar como green. Reabrir quando o oráculo de integração existir.
