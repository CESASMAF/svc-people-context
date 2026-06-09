# Regra: Segurança & LGPD — people-context

Invariantes de segurança/privacidade. Violar isto é bug crítico. Fonte: CLAUDE.md, ADRs, findings de AppSec.

## SQL
- **100% parametrizado** via `Bun.sql` tagged templates: `sql\`... ${value} ...\``. NUNCA interpolar string em SQL.
- Listas de coluna estáticas via **fragmento `Bun.sql`** (`const fields = sql\`col AS "alias", ...\``),
  não via `sql.unsafe`. O driver é o **nativo do Bun** (migrado de postgres.js — ver `docs/adr/0002`).

## LGPD — minimização de PII
- **CPF NUNCA entra em payload de evento NATS** (AppSec HIGH-8). Eventos de pessoa carregam só `fullName`/`birthDate`/ids — nunca `cpf`.
- PII não vaza em logs nem em mensagens de erro.

## Provisionamento no IdP (Authentik)
- **IdP-first** (AppSec HIGH-5): a mutação no Authentik vem ANTES do DB; não há rollback compensatório — ordem importa.
- **Erros do Authentik não vazam** no response HTTP (HIGH-7) — mapear para `IDP-00x` genérico.
- `pk` (integer) para mutações DRF; `uid` (hex64) é o `JWT.sub` / actorId / audit (ADR-027).
- **Password reset link viaja APENAS no evento NATS** `people.user.password_reset_requested` — **nunca** no response HTTP (ADR-030, AppSec CRITICAL-2).
- `legacy_zitadel_sub` mora em `attributes` para users migrados (ADR-031).

## AuthZ (RBAC)
- `actorId` = `JWT.sub` (ADR-023); header `X-Actor-Id` obrigatório em mutações (POST/PUT/DELETE) → senão `AUTH-003`.
- `superadmin` faz bypass de checagem de role.
- `admin` é **escopado ao próprio sistema**: `social-care:admin` só atua em `social-care` → cross-system = `ROL-007`.
- Proibido auto-assign (`uid` do JWT ≠ pessoa alvo) → `ROL-008`.
- Token inválido/ausente → `AUTH-001`; sem role exigida → `AUTH-002`.

## Auth — Authentik (migração concluída)
- `middleware/jwt.ts` valida JWKS do **Authentik** (OIDC). Issuer/JWKS derivados de `AUTHENTIK_URL` + `AUTHENTIK_APP_SLUG` (`<url>/application/o/<slug>/` + `.../jwks/`); overrides via `OIDC_ISSUER`/`JWKS_URL`. Validação opcional de `aud` via `OIDC_AUDIENCE`.
- Roles vêm do claim **`groups`** (array de nomes homônimos a `system:role` + `superadmin`; nome do claim configurável via `OIDC_ROLES_CLAIM`). Provisionamento e validação agora apontam para o **mesmo** IdP — sem split-brain.
- Cobertura de testes: `tests/middleware/jwt-verifier.test.ts` exercita o fluxo de verificação real (RS256 com chaves geradas pelo `jose`, JWKS + introspection mockados — groups, issuer, audience, fallback de service account). Pendência remanescente: smoke contra instância Authentik **real** (os smoke em `tests/idp/` já cobrem o Management API). Ao mexer em auth, consulte `ref-authentik` para JWKS/issuer/claims e confirme o estado real no código.

## Secrets
- Apenas variáveis de ambiente (Bitwarden/Infisical em prod). Validação fail-fast no startup: se `AUTHENTIK_URL` xor `AUTHENTIK_TOKEN`, abortar (HIGH-10).

## Códigos de erro (envelope `{ success:false, error:{ code, message } }`)
`PEO-001..010` (person; 008=já tem login, 009=email obrigatório p/ login, 010=só superadmin deleta) · `ROL-001..009` (role) · `IDP-001..005` (idp; 005=falha ao deletar user no IdP) · `AUTH-001..003` (auth) · `ADM-001` (reconciliação restrita a superadmin).
