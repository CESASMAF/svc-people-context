# ADR-0001: Migração para TypeScript 6.0 e Bun 1.3.14

**Status**: Accepted

**Data**: 2026-06-09

**Escopo**: `people-context` (serviço). Primeiro ADR mantido localmente em `docs/adr/`.
Os ADRs `ADR-0XX` citados no `CLAUDE.md`/`.claude/rules/` (014, 023, 027, 029, 030, 031)
pertencem à série compartilhada do ecossistema e moram em outros repositórios — este
ADR-0001 abre uma série **local** ao `people-context` para decisões de tooling/infra do serviço.

**Decisores**: Gabriel Aderaldo (+ Claude Code)

## Contexto

Três forças convergiram:

1. **Divergência de toolchain no monorepo.** O serviço `web` já roda **TypeScript 6.0.3**; o
   `people-context` estava preso em **TypeScript 5.9** (peer `typescript: "^5"`, resolvido transitivo
   via `typescript-eslint`). A divergência é explicitamente rastreada pela Reference Network
   (`ref-typescript`: "web usa TS 6.0.3; people-context usa TS 5.9").

2. **Runtime desatualizado.** O `package.json`/CI pinavam **Bun 1.3.11**; o upstream estava em
   **1.3.14**, com correções de estabilidade relevantes (TLS/`node:http`, `bun:test`) e ganhos de
   performance (carregamento de ESM ~12% mais rápido), **sem breaking changes**.

3. **PRs do Dependabot represados.** `jose 6.2.2→6.2.3` (#4) e `actions/checkout 6.0.2→6.0.3` (#5)
   estavam abertos; o #4 falhava no CI por `error: lockfile had changes, but lockfile is frozen`
   (o Dependabot do ecossistema npm não sincroniza o `bun.lock`). Aplicar os bumps em conjunto com
   a migração, num único PR já verde, resolve o represamento.

O `tsconfig.json` já estava alinhado às recomendações do Bun para TS6 (`module: "Preserve"`,
`moduleDetection: "force"`, `moduleResolution: "bundler"`) — faltava apenas absorver **a única
breaking change do TS 6.0**: o campo `types` deixou de defaultar para "todos os `@types/*`" e passou
a defaultar para `[]`.

## Decisão

Migramos o `people-context` para **TypeScript 6.0** e **Bun 1.3.14**, e aplicamos os dois bumps do
Dependabot no mesmo PR (#6):

- `typescript` → `^6` (resolve **6.0.3**, alinhado ao `web`); peer dep atualizada para `^6`.
- `tsconfig.json`: adicionado `"types": ["bun"]` — declara explicitamente os globais do runtime Bun
  e do `bun:test`, absorvendo a mudança de default do TS 6.0.
- `bun-version` do CI (`oven-sh/setup-bun`) → **1.3.14**.
- `jose` → **6.2.3**; `actions/checkout` → **v6.0.3** (`df4cb1c…`, pin por SHA) em `ci.yml` + `codeql.yml`.
- `bun.lock` sincronizado via `bun install` (resolve o `frozen lockfile` que travava o PR #4).

**Não** adotamos bundling: o serviço roda via `bun run src/index.ts` (sem etapa de build). O doc de
compatibilidade `Bun.build`↔`esbuild` foi revisado e fica registrado como referência para um eventual
empacotamento futuro — `Bun.build` é "esbuild-compatible" porém com diferenças (sempre faz bundle por
padrão, sem dev server, `entrypoints`/`naming`/`target` renomeados) — mas **nada disso se aplica hoje**.

## Citação canônica

> Por ser uma decisão de **tooling/versão** (não de arquitetura de domínio), o princípio IX é
> satisfeito pelas **fontes upstream oficiais**, que são o corpus canônico para este tipo de decisão —
> e não pela literatura de DDD/arquitetura:

- **TypeScript 6.0 — discovery de tipos** (bun.com/docs/typescript-6): _"TypeScript 6.0 changed how
  type definitions are discovered"_ — o campo `types` em `compilerOptions` passa a defaultar para
  array vazio em vez de incluir todos os `@types/*`; daí a necessidade de `"types": ["bun"]`. O
  _default_ é mantido no TS 7.
- **typescript-eslint 8.61.0** (`peerDependencies`): `"typescript": ">=4.8.4 <6.1.0"` — TS 6.0.x está
  **dentro** da faixa suportada; a migração não exige bump do typescript-eslint.
- **Bun v1.3.14** (bun.com/blog/bun-v1.3.14): "**Nenhum breaking change** anunciado para APIs públicas"
  — correções de `node:http`/TLS, `bun:test` (`{skip,todo}` no top-level), ESM ~12% mais rápido.
- **jose v6.2.3** (panva/jose): única mudança "_cleanly reject invalid PBES2 p2c_" — refactor isolado
  ao PBES2 (cripto por senha); **não toca** RS256/JWKS/`jwtVerify`, que é o uso do `middleware/jwt.ts`.
- **actions/checkout v6.0.3**: bug fixes de repositórios SHA-256 e regex de merge-commit; sem impacto
  em workflow típico.

## Alternativas consideradas

- **Permanecer em TS 5.9** — rejeitada: perpetua a divergência com o `web`, mantém o serviço fora do
  default de `types` do TS 6/7 e não captura os fixes do Bun 1.3.14.
- **Apenas documentar a migração (sem aplicar)** — rejeitada: o pedido era aplicar + documentar, e a
  validação empírica (`bun run verify` verde sob TS 6.0.3) já comprovou que a migração é segura agora.
- **Mergear os PRs #4/#5 do Dependabot isoladamente** — rejeitada para o #4: ele continuaria falhando
  no `frozen lockfile` (Dependabot npm não atualiza `bun.lock`); aplicar os bumps neste PR já verde
  é mais limpo.
- **Adotar `Bun.build` (bundling)** — fora de escopo: o serviço não tem etapa de build; rodar via
  `bun run` é suficiente. Registrado para revisão futura.

## Consequências

- **Positivas**:
  - Toolchain alinhada ao `web` (TS 6.0.3) — fim da divergência rastreada.
  - Fixes de estabilidade/performance do Bun 1.3.14 (TLS/`node:http`, `bun:test`, ESM).
  - `bun.lock` sincronizado destrava os bumps do Dependabot; jose/checkout atualizados.
  - `"types": ["bun"]` torna a superfície de tipos **explícita** (apenas globais do Bun), evitando
    vazamento acidental de `@types/*` transitivos.
- **Negativas / trade-offs**:
  - **Devs locais devem `bun upgrade`** para 1.3.14 (a máquina de referência estava em 1.3.11; a
    validação local rodou em 1.3.11, mas o 1.3.14 é não-breaking). O CI já roda 1.3.14.
  - **Teto do typescript-eslint**: suporta `<6.1.0`. Quando o TS 6.1 sair, será preciso bumpar o
    `typescript-eslint` junto. O `^6` no `package.json` é seguro hoje porque o `bun.lock` fixa 6.0.3.
- **Impacto em BCs / outbox / migrations**: **nenhum** — mudança puramente de toolchain/versões.
  `bun run verify` permanece **verde** (typecheck TS6 + format + lint 0/0 + 255 testes + coverage 97.95%).
