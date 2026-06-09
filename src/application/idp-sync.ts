// Application layer — orquestracao entre routes e AuthentikClient.
//
// Resolve Architecture HIGH-1 (review 2026-05-13): routes nao devem conter
// logica de orquestracao IdP duplicada. As funcoes aqui sao puras e testaveis
// isoladamente, importadas pelas routes para manter handlers thin.
//
// Aderencia ao CLAUDE.md do people-context: pure functions, sem class,
// `Result<T>` ja vem do AuthentikClient.

import type {
  ACDGUserAttributes,
  AuthentikClient,
  AuthentikGroupPk,
  AuthentikResult,
  AuthentikUserPk,
  AuthentikUserUid,
} from "../idp/index.ts";

// ─── Convencao role → group ────────────────────────────────────
//
// (system, role) e mapeado para um Group homonimo no Authentik.
// Ex: system="social-care", role="admin" → group name "social-care:admin"
//
// O group precisa existir no Authentik (criacao via blueprint, conforme
// ADR-029). Se nao existir, role-sync e best-effort: log + skip, mas o
// state local no Postgres do people-context sempre persiste.

export const roleKeyForGroup = (system: string, role: string): string => `${system}:${role}`;

// ─── Helpers para routes ───────────────────────────────────────

// Resolve um (system, role) para o pk do Group correspondente no Authentik.
// Retorna null se grupo nao existe (best-effort + warning log).
export const findGroupByRoleKey = async (
  idp: AuthentikClient,
  system: string,
  role: string,
): Promise<AuthentikGroupPk | null> => {
  const key = roleKeyForGroup(system, role);
  const result = await idp.findGroupByName(key);
  if (!result.ok || result.data === null) {
    console.warn(`[idp] group '${key}' nao encontrado no Authentik — role-sync pulado`);
    return null;
  }
  return result.data.pk;
};

// Sincroniza atribuicao de role (add user ao group correspondente).
// Code-review HIGH-2: Result e tratado (nao silenciado).
export const syncRoleAssignment = async (
  idp: AuthentikClient,
  args: {
    readonly system: string;
    readonly role: string;
    readonly idpUserPk: number;
    readonly personId: string;
  },
): Promise<void> => {
  const groupPk = await findGroupByRoleKey(idp, args.system, args.role);
  if (groupPk === null) return;

  const sync = await idp.addUserToGroup(groupPk, args.idpUserPk);
  if (!sync.ok) {
    console.warn(
      `[idp] role-sync addUserToGroup failed personId=${args.personId} ` +
        `group=${groupPk} code=${sync.code}: ${sync.message}`,
    );
  }
};

// Sincroniza remocao de role (remove user do group correspondente).
export const syncRoleRemoval = async (
  idp: AuthentikClient,
  args: {
    readonly system: string;
    readonly role: string;
    readonly idpUserPk: number;
    readonly personId: string;
  },
): Promise<void> => {
  const groupPk = await findGroupByRoleKey(idp, args.system, args.role);
  if (groupPk === null) return;

  const sync = await idp.removeUserFromGroup(groupPk, args.idpUserPk);
  if (!sync.ok) {
    console.warn(
      `[idp] role-sync removeUserFromGroup failed personId=${args.personId} ` +
        `group=${groupPk} code=${sync.code}: ${sync.message}`,
    );
  }
};

// ─── Username derivation + unicidade ───────────────────────────

// Deriva o username BASE a partir do email (parte antes do @).
export const usernameFromEmail = (email: string): string =>
  email.split("@")[0]?.toLowerCase() ?? email.toLowerCase();

// Resolve um username unico a partir de um base, consultando o Authentik.
// Code-review MEDIUM-15 fix: elimina a colisao silenciosa (`joao@x.com` e
// `joao@y.com` derivavam o mesmo `joao` e o 2o falhava com 409 -> warning).
// Tenta `base`, `base2`, `base3`... ate USERNAME_MAX_ATTEMPTS. Se a checagem
// no IdP falhar (rede), devolve o candidato e deixa o `createUser` decidir.
// Esgotando as tentativas, sufixa com fragmento aleatorio (garante unicidade).
const USERNAME_MAX_ATTEMPTS = 50;

export const resolveUniqueUsername = async (
  idp: AuthentikClient,
  base: string,
): Promise<string> => {
  for (let i = 0; i < USERNAME_MAX_ATTEMPTS; i++) {
    const candidate = i === 0 ? base : `${base}${i + 1}`;
    const found = await idp.findUserByUsername(candidate);
    if (!found.ok) return candidate;
    if (found.data === null) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
};

// ─── Sincroniza perfil (name/email) com o IdP (PUT /people/:id) ─
//
// Best-effort pos-DB: o registro local e a fonte de verdade; uma falha de
// sync gera warning e nao quebra o update (alinhado ao role-sync). Erros do
// Authentik nao vazam (HIGH-7) — ficam no log.
export const syncPersonProfileToIdp = async (
  idp: AuthentikClient,
  args: {
    readonly idpUserPk: number;
    readonly name: string;
    readonly email?: string;
    readonly personId: string;
  },
): Promise<void> => {
  const result = await idp.updateUserProfile(args.idpUserPk, {
    name: args.name,
    ...(args.email ? { email: args.email } : {}),
  });
  if (!result.ok) {
    console.warn(
      `[idp] profile-sync failed personId=${args.personId} ` +
        `pk=${args.idpUserPk} code=${result.code}: ${result.message}`,
    );
  }
};

// ─── Provision user no IdP ─────────────────────────────────────
//
// Resolve Architecture M1 (review 2026-05-13): routes nao mais chamam
// `idp.createUser` + `idp.setPassword` separadamente; usam esta funcao
// que orquestra os dois passos atomicamente do ponto de vista da route.
//
// Erros do setPassword sao logados como warning (HIGH-3 — Result tratado)
// mas nao falham o provision: usuario ja foi criado, falta apenas a senha
// inicial (recuperavel via recovery flow).

export interface ProvisionUserInput {
  readonly username: string;
  readonly name: string;
  readonly email: string;
  readonly initialPassword?: string;
  readonly attributes: ACDGUserAttributes;
}

export interface ProvisionedUser {
  readonly uid: AuthentikUserUid;
  readonly pk: AuthentikUserPk;
}

// `input.username` e tratado como BASE: a unicidade e resolvida via
// resolveUniqueUsername. Em caso de 409 (race entre a checagem e o create),
// re-resolve e tenta de novo ate PROVISION_MAX_ATTEMPTS.
const PROVISION_MAX_ATTEMPTS = 3;

export const provisionUserInIdp = async (
  idp: AuthentikClient,
  input: ProvisionUserInput,
): Promise<AuthentikResult<ProvisionedUser>> => {
  for (let attempt = 0; attempt < PROVISION_MAX_ATTEMPTS; attempt++) {
    const username = await resolveUniqueUsername(idp, input.username);
    const createResult = await idp.createUser({
      username,
      name: input.name,
      email: input.email,
      is_active: true,
      path: "users",
      type: "internal",
      attributes: input.attributes,
    });

    if (createResult.ok) {
      if (input.initialPassword) {
        const pwdResult = await idp.setPassword(createResult.data.pk, input.initialPassword);
        if (!pwdResult.ok) {
          console.warn(
            `[idp] setPassword failed for pk=${createResult.data.pk} ` +
              `code=${pwdResult.code} — user criado, senha inicial nao aplicada (recuperavel via recovery)`,
          );
        }
      }
      return { ok: true, data: { uid: createResult.data.uid, pk: createResult.data.pk } };
    }

    // 409 = colisao de username (race). Re-resolve e tenta novamente.
    // Qualquer outro erro e nao recuperavel — devolve direto.
    if (createResult.code !== 409) return createResult;
  }

  return { ok: false, code: 409, message: "username conflict after retries" };
};
