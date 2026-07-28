// Application layer — orquestracao entre routes e IdpClient (Ory Kratos).
//
// Resolve Architecture HIGH-1 (review 2026-05-13): routes nao devem conter
// logica de orquestracao IdP duplicada. As funcoes aqui sao puras e testaveis
// isoladamente, importadas pelas routes para manter handlers thin.
//
// Aderencia ao CLAUDE.md: pure functions, sem class, `Result<T>` ja vem do
// IdpClient.

import type { ACDGUserAttributes, IdpClient, IdpResult, IdpUserId } from "../idp/index.ts";

// ─── Convencao role → group ────────────────────────────────────
//
// (system, role) vira uma string `<system>:<role>` no array
// `metadata_public.groups` da identity Kratos (ADR-029). Ex: system="social-care",
// role="admin" → "social-care:admin". A consent-bridge exporta esse array no claim
// `groups` do token. NAO ha objeto de grupo a pre-criar (diferente do Authentik):
// add/remove é read-modify-write no array — best-effort (o state local no Postgres
// do people-context é a fonte de verdade).

export const roleKeyForGroup = (system: string, role: string): string => `${system}:${role}`;

// ─── Helpers para routes ───────────────────────────────────────

// Sincroniza atribuicao de role (adiciona `<system>:<role>` em groups).
// Code-review HIGH-2: Result e tratado (nao silenciado).
export const syncRoleAssignment = async (
  idp: IdpClient,
  args: {
    readonly system: string;
    readonly role: string;
    readonly idpUserId: IdpUserId;
    readonly personId: string;
  },
): Promise<void> => {
  const key = roleKeyForGroup(args.system, args.role);
  const sync = await idp.addUserToGroup(key, args.idpUserId);
  if (!sync.ok) {
    console.warn(
      `[idp] role-sync addUserToGroup failed personId=${args.personId} ` +
        `group=${key} code=${sync.code}: ${sync.message}`,
    );
  }
};

// Sincroniza remocao de role (remove `<system>:<role>` de groups).
export const syncRoleRemoval = async (
  idp: IdpClient,
  args: {
    readonly system: string;
    readonly role: string;
    readonly idpUserId: IdpUserId;
    readonly personId: string;
  },
): Promise<void> => {
  const key = roleKeyForGroup(args.system, args.role);
  const sync = await idp.removeUserFromGroup(key, args.idpUserId);
  if (!sync.ok) {
    console.warn(
      `[idp] role-sync removeUserFromGroup failed personId=${args.personId} ` +
        `group=${key} code=${sync.code}: ${sync.message}`,
    );
  }
};

// ─── Username derivation ────────────────────────────────────────
//
// No Kratos o identifier de login é o EMAIL (unico). O username é apenas
// display/audit (persistido em metadata_public.username) — nao precisa ser unico,
// entao a resolucao de colisao do Authentik saiu. Mantido como helper puro.
export const usernameFromEmail = (email: string): string =>
  email.split("@")[0]?.toLowerCase() ?? email.toLowerCase();

// ─── Sincroniza perfil (name/email) com o IdP (PUT /people/:id) ─
//
// Best-effort pos-DB: o registro local e a fonte de verdade; uma falha de sync
// gera warning e nao quebra o update (alinhado ao role-sync). Erros do IdP nao
// vazam (HIGH-7) — ficam no log.
export const syncPersonProfileToIdp = async (
  idp: IdpClient,
  args: {
    readonly idpUserId: IdpUserId;
    readonly name: string;
    readonly email?: string;
    readonly personId: string;
  },
): Promise<void> => {
  const result = await idp.updateUserProfile(args.idpUserId, {
    name: args.name,
    ...(args.email !== undefined && args.email !== "" ? { email: args.email } : {}),
  });
  if (!result.ok) {
    console.warn(
      `[idp] profile-sync failed personId=${args.personId} ` +
        `id=${args.idpUserId} code=${result.code}: ${result.message}`,
    );
  }
};

// ─── Provision user no IdP ─────────────────────────────────────
//
// Resolve Architecture M1 (review 2026-05-13): routes nao chamam createUser +
// setPassword separadamente; usam esta funcao. No Kratos a senha inicial vai
// direto no createUser (credentials.password), entao é uma unica chamada.
//
// A unicidade é por EMAIL (identifier do Kratos). Colisao → 409, devolvido ao
// caller. O `username` é so display (metadata_public.username), nao precisa de
// resolucao de unicidade.

export interface ProvisionUserInput {
  readonly username: string;
  readonly name: string;
  readonly email: string;
  readonly initialPassword?: string;
  readonly attributes: ACDGUserAttributes;
}

export interface ProvisionedUser {
  readonly id: IdpUserId;
}

export const provisionUserInIdp = async (
  idp: IdpClient,
  input: ProvisionUserInput,
): Promise<IdpResult<ProvisionedUser>> => {
  const createResult = await idp.createUser({
    username: input.username,
    name: input.name,
    email: input.email,
    is_active: true,
    ...(input.initialPassword !== undefined && input.initialPassword !== ""
      ? { password: input.initialPassword }
      : {}),
    attributes: input.attributes,
  });
  if (!createResult.ok) return createResult;
  return { ok: true, data: { id: createResult.data.id } };
};
