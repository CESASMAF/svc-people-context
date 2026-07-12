// ─── Ory Kratos Admin API types ─────────────────────────────────
//
// Migrado da Management API do Authentik (ADR-027) para a Admin API do Kratos.
// Um "user" = uma **identity** do Kratos, com um único identificador:
//   `id` (UUID) — vai no `sub` do JWT (via Hydra consent-bridge) e é o actorId
//   do audit trail (ADR-023). Não há mais `pk` (int) nem `uid` (hex) separados.
//
// Papéis (roles) NÃO são objetos de grupo: a associação vive em
// `metadata_public.groups` (array `<system>:<role>` + `superadmin`), editada por
// read-modify-write (GET + PUT) na identity. É desse array que a consent-bridge
// deriva o claim `groups` do token.

// ─── Result type (no throw boundary, ADR-014 cross-context) ─────

export type IdpResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: number; readonly message: string };

// ─── Identifier ─────────────────────────────────────────────────

export type IdpUserId = string; // Kratos identity UUID (= `sub` do JWT)

// ─── Custom attributes ACDG (vão em metadata_public, ao lado de `groups`) ──
//
// AppSec CRITICAL-3: shape FECHADO (sem index signature) — bloqueia mass
// assignment de chaves arbitrárias, em especial `legacy_zitadel_sub`.
export interface ACDGUserAttributes {
  readonly cpf?: string;
  readonly person_id?: string;
  readonly org_id?: string;
  readonly legacy_zitadel_sub?: string;
  readonly settings?: {
    readonly locale?: string;
  };
}

// ─── User CRUD ──────────────────────────────────────────────────

export interface CreateUserInput {
  readonly username: string; // display/audit — persistido em metadata_public.username
  readonly name: string;
  readonly email: string; // identifier de login no Kratos (credentials.password)
  readonly is_active?: boolean; // default true
  readonly groups?: readonly string[]; // roles `<system>:<role>` (default [])
  readonly attributes?: ACDGUserAttributes;
  readonly password?: string; // senha inicial (opcional) — gravada na criação
}

// Patch de perfil — só envia o que mudou (PUT parcial via read-modify-write).
export interface UpdateUserProfileInput {
  readonly name?: string;
  readonly email?: string;
  readonly attributes?: ACDGUserAttributes;
}

export interface IdpUser {
  readonly id: IdpUserId;
  readonly username: string;
  readonly name: string;
  readonly email: string;
  readonly active: boolean; // Kratos state === "active"
  readonly groups: readonly string[]; // metadata_public.groups
  readonly attributes: ACDGUserAttributes; // metadata_public sem `groups`/`username`
  readonly createdAt: string; // identity.created_at (ISO 8601)
}

// ─── Recovery (password reset) ──────────────────────────────────

export interface RecoveryLinkResponse {
  readonly link: string; // Kratos recovery_link (URL one-time)
}

// ─── Client contract ────────────────────────────────────────────

export interface IdpClient {
  // Users
  readonly createUser: (input: CreateUserInput) => Promise<IdpResult<IdpUser>>;

  readonly getUser: (id: IdpUserId) => Promise<IdpResult<IdpUser>>;

  readonly findUserByEmail: (email: string) => Promise<IdpResult<IdpUser | null>>;

  readonly setPassword: (id: IdpUserId, password: string) => Promise<IdpResult<undefined>>;

  readonly deactivateUser: (id: IdpUserId) => Promise<IdpResult<undefined>>;

  readonly reactivateUser: (id: IdpUserId) => Promise<IdpResult<undefined>>;

  readonly deleteUser: (id: IdpUserId) => Promise<IdpResult<undefined>>;

  readonly updateUserAttributes: (
    id: IdpUserId,
    attributes: ACDGUserAttributes,
  ) => Promise<IdpResult<IdpUser>>;

  readonly updateUserProfile: (
    id: IdpUserId,
    patch: UpdateUserProfileInput,
  ) => Promise<IdpResult<IdpUser>>;

  // Recovery (password reset)
  readonly requestPasswordReset: (id: IdpUserId) => Promise<IdpResult<RecoveryLinkResponse>>;

  // Roles (metadata_public.groups) — `group` é a string `<system>:<role>`
  readonly addUserToGroup: (group: string, id: IdpUserId) => Promise<IdpResult<undefined>>;

  readonly removeUserFromGroup: (group: string, id: IdpUserId) => Promise<IdpResult<undefined>>;

  readonly listUserGroups: (id: IdpUserId) => Promise<IdpResult<readonly string[]>>;
}
