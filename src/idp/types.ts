// ─── Authentik Management API types ────────────────────────────
//
// Tipos cobrem operacoes que `people-context` precisa: CRUD de users,
// gerenciamento de groups, password reset, service accounts (M2M).
//
// Identificadores no Authentik:
// - `pk` (number)   — primary key interno do Django. Usado em endpoints (/api/v3/core/users/{pk}/).
// - `uid` (string)  — hash hex64 estavel. Vai no `sub` do JWT — usado como actorId no audit trail (ADR-023).
//
// Para `social-care` o `uid` e o actorId. Para chamadas outbound, use `pk`.

// ─── Result type (no throw boundary, ADR-014 cross-context) ─────

export type AuthentikResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: number; readonly message: string };

// ─── Identifier types ───────────────────────────────────────────

export type AuthentikUserPk = number;
export type AuthentikUserUid = string;
export type AuthentikGroupPk = string; // UUID

// ─── Custom attributes ACDG ────────────────────────────────────
//
// Decidido em 2026-05-13 (ADR-027 secao "Decisoes operacionais"):
// `org_id` em toda conta cadastrada (preparado para multi-org futuro sem refactor).
// `legacy_zitadel_sub` presente apenas em users migrados (ADR-031).

// AppSec CRITICAL-3 fix: shape FECHADO (sem index signature).
// Bloqueia mass assignment de chaves arbitrarias vindas do body
// para attributes — especialmente `legacy_zitadel_sub` que vira
// claim no JWT via property mapping `acdg-roles`. Index signature
// `[key: string]: unknown` foi removida.
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
  readonly username: string;
  readonly name: string;
  readonly email: string;
  readonly is_active?: boolean; // default true
  readonly path?: string; // default "users"
  readonly type?: "internal" | "external" | "service_account"; // default "internal"
  readonly groups?: readonly AuthentikGroupPk[];
  readonly attributes?: ACDGUserAttributes;
}

// Patch de perfil — campos editaveis sincronizados a partir de PUT /people/:id.
// Todos opcionais: PATCH no Authentik so envia o que mudou.
export interface UpdateUserProfileInput {
  readonly name?: string;
  readonly email?: string;
  readonly attributes?: ACDGUserAttributes;
}

export interface UserResponse {
  readonly pk: AuthentikUserPk;
  readonly uid: AuthentikUserUid;
  readonly username: string;
  readonly name: string;
  readonly email: string;
  readonly is_active: boolean;
  readonly is_superuser: boolean;
  readonly groups: readonly AuthentikGroupPk[];
  readonly attributes: ACDGUserAttributes;
  readonly date_joined: string; // ISO 8601
  readonly last_login: string | null;
}

// ─── Group ──────────────────────────────────────────────────────

export interface GroupSummary {
  readonly pk: AuthentikGroupPk;
  readonly name: string;
  readonly is_superuser: boolean;
}

// ─── Service Account (M2M) ──────────────────────────────────────
//
// Endpoint POST /api/v3/core/users/service_account/ cria SA + token + group
// em uma unica chamada. Token retornado e Bearer pronto para usar.
// Detalhes em ADR-027 secao "Service accounts (M2M)".

export interface CreateServiceAccountInput {
  readonly name: string;
  readonly create_group?: boolean; // default false
  readonly expiring?: boolean; // default true
  readonly expires?: string; // ISO 8601, default +360d
}

export interface ServiceAccountResponse {
  readonly username: string;
  readonly token: string; // Bearer token pronto para uso
  readonly user_uid: AuthentikUserUid;
  readonly user_pk: AuthentikUserPk;
  readonly group_pk?: AuthentikGroupPk;
}

// ─── Recovery (password reset) ──────────────────────────────────

export interface RecoveryLinkResponse {
  readonly link: string; // URL one-time para o user clicar
}

// ─── Client contract ────────────────────────────────────────────

export interface AuthentikClient {
  // Users
  readonly createUser: (input: CreateUserInput) => Promise<AuthentikResult<UserResponse>>;

  readonly getUser: (userPk: AuthentikUserPk) => Promise<AuthentikResult<UserResponse>>;

  readonly findUserByUsername: (username: string) => Promise<AuthentikResult<UserResponse | null>>;

  // Resolve uid (sub do JWT, gravado em people.idp_user_id) -> user completo
  // Usado pelas rotas quando temos so o uid persistido mas precisamos do pk.
  readonly findUserByUid: (uid: AuthentikUserUid) => Promise<AuthentikResult<UserResponse | null>>;

  readonly setPassword: (
    userPk: AuthentikUserPk,
    password: string,
  ) => Promise<AuthentikResult<void>>;

  readonly deactivateUser: (userPk: AuthentikUserPk) => Promise<AuthentikResult<void>>;

  readonly reactivateUser: (userPk: AuthentikUserPk) => Promise<AuthentikResult<void>>;

  readonly deleteUser: (userPk: AuthentikUserPk) => Promise<AuthentikResult<void>>;

  readonly updateUserAttributes: (
    userPk: AuthentikUserPk,
    attributes: ACDGUserAttributes,
  ) => Promise<AuthentikResult<UserResponse>>;

  // Atualiza perfil (name/email/attributes) — usado para manter o IdP em
  // sincronia com PUT /people/:id. PATCH parcial: so envia campos presentes.
  readonly updateUserProfile: (
    userPk: AuthentikUserPk,
    patch: UpdateUserProfileInput,
  ) => Promise<AuthentikResult<UserResponse>>;

  // Recovery (password reset)
  readonly requestPasswordReset: (
    userPk: AuthentikUserPk,
  ) => Promise<AuthentikResult<RecoveryLinkResponse>>;

  // Groups
  readonly findGroupByName: (name: string) => Promise<AuthentikResult<GroupSummary | null>>;

  readonly addUserToGroup: (
    groupPk: AuthentikGroupPk,
    userPk: AuthentikUserPk,
  ) => Promise<AuthentikResult<void>>;

  readonly removeUserFromGroup: (
    groupPk: AuthentikGroupPk,
    userPk: AuthentikUserPk,
  ) => Promise<AuthentikResult<void>>;

  readonly listUserGroups: (
    userPk: AuthentikUserPk,
  ) => Promise<AuthentikResult<readonly GroupSummary[]>>;

  // Service Account (M2M)
  readonly createServiceAccount: (
    input: CreateServiceAccountInput,
  ) => Promise<AuthentikResult<ServiceAccountResponse>>;
}
