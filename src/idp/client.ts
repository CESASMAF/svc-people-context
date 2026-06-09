import type {
  AuthentikClient,
  AuthentikGroupPk,
  AuthentikResult,
  AuthentikUserPk,
  CreateServiceAccountInput,
  CreateUserInput,
  GroupSummary,
  RecoveryLinkResponse,
  ServiceAccountResponse,
  UpdateUserProfileInput,
  UserResponse,
  ACDGUserAttributes,
} from "./types.ts";

// ─── Config ────────────────────────────────────────────────────

interface AuthentikClientConfig {
  readonly baseUrl: string;
  readonly token: string;
}

// ─── HTTP helper (never throws — boundary do Result) ───────────
//
// try/catch existe APENAS aqui (boundary infra). Toda funcao publica
// devolve Result<T, E> em vez de propagar excecao. Conforme ADR-014
// (Result pattern end-to-end) e regra do CLAUDE.md.

const request = async <T>(
  config: AuthentikClientConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<AuthentikResult<T>> => {
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // 204 No Content: caller deve usar T = undefined. Code-review HIGH-5:
    // restringe ao status 204 estritamente (nao confundir com 200 body vazio).
    // O cast `as T` e necessario porque o protocolo HTTP nao tem como expressar
    // "this response carries no body" no nivel de tipos do fetch.
    if (response.status === 204) {
      return { ok: true, data: undefined as T };
    }

    if (response.ok) {
      const data = (await response.json()) as T;
      return { ok: true, data };
    }

    const errorBody = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(errorBody) as {
        detail?: string;
        error?: string;
        error_description?: string;
      };
      message = parsed.detail ?? parsed.error_description ?? parsed.error ?? errorBody;
    } catch {
      message = errorBody;
    }

    return { ok: false, code: response.status, message };
  } catch (err) {
    return {
      ok: false,
      code: 0,
      message: err instanceof Error ? err.message : "Unknown network error",
    };
  }
};

// ─── DRF paginated response ────────────────────────────────────

interface PaginatedResponse<T> {
  readonly results: readonly T[];
  readonly pagination: { readonly count: number };
}

// ─── Factory ───────────────────────────────────────────────────

export const createAuthentikClient = (config: AuthentikClientConfig): AuthentikClient => ({
  // ── Users ────────────────────────────────────────────────────

  createUser: async (input: CreateUserInput) =>
    request<UserResponse>(config, "POST", "/api/v3/core/users/", {
      username: input.username,
      name: input.name,
      email: input.email,
      is_active: input.is_active ?? true,
      path: input.path ?? "users",
      type: input.type ?? "internal",
      groups: input.groups ?? [],
      attributes: input.attributes ?? {},
    }),

  getUser: async (userPk: AuthentikUserPk) =>
    request<UserResponse>(config, "GET", `/api/v3/core/users/${userPk}/`),

  findUserByUsername: async (username: string) => {
    const result = await request<PaginatedResponse<UserResponse>>(
      config,
      "GET",
      `/api/v3/core/users/?username=${encodeURIComponent(username)}`,
    );
    if (!result.ok) return result;
    const first = result.data.results[0];
    return { ok: true as const, data: first ?? null };
  },

  findUserByUid: async (uid) => {
    const result = await request<PaginatedResponse<UserResponse>>(
      config,
      "GET",
      `/api/v3/core/users/?uid=${encodeURIComponent(uid)}`,
    );
    if (!result.ok) return result;
    const first = result.data.results[0];
    return { ok: true as const, data: first ?? null };
  },

  // Code-review HIGH-18: descartamos qualquer body que o Authentik possa
  // retornar (algumas versoes retornam {}). Tipo void e garantido aqui.
  setPassword: async (userPk: AuthentikUserPk, password: string) => {
    const result = await request<unknown>(
      config,
      "POST",
      `/api/v3/core/users/${userPk}/set_password/`,
      { password },
    );
    if (!result.ok) return result;
    return { ok: true as const, data: undefined };
  },

  deactivateUser: async (userPk: AuthentikUserPk) => {
    const result = await request<UserResponse>(config, "PATCH", `/api/v3/core/users/${userPk}/`, {
      is_active: false,
    });
    if (!result.ok) return result;
    return { ok: true as const, data: undefined };
  },

  reactivateUser: async (userPk: AuthentikUserPk) => {
    const result = await request<UserResponse>(config, "PATCH", `/api/v3/core/users/${userPk}/`, {
      is_active: true,
    });
    if (!result.ok) return result;
    return { ok: true as const, data: undefined };
  },

  deleteUser: async (userPk: AuthentikUserPk) =>
    request<undefined>(config, "DELETE", `/api/v3/core/users/${userPk}/`),

  updateUserAttributes: async (userPk: AuthentikUserPk, attributes: ACDGUserAttributes) =>
    request<UserResponse>(config, "PATCH", `/api/v3/core/users/${userPk}/`, { attributes }),

  // PATCH parcial: monta o body apenas com os campos presentes no patch,
  // evitando sobrescrever name/email/attributes com undefined no Authentik.
  updateUserProfile: async (userPk: AuthentikUserPk, patch: UpdateUserProfileInput) =>
    request<UserResponse>(config, "PATCH", `/api/v3/core/users/${userPk}/`, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.attributes !== undefined ? { attributes: patch.attributes } : {}),
    }),

  // ── Recovery ─────────────────────────────────────────────────

  requestPasswordReset: async (userPk: AuthentikUserPk) =>
    request<RecoveryLinkResponse>(config, "POST", `/api/v3/core/users/${userPk}/recovery/`, {}),

  // ── Groups ───────────────────────────────────────────────────

  findGroupByName: async (name: string) => {
    const result = await request<PaginatedResponse<GroupSummary>>(
      config,
      "GET",
      `/api/v3/core/groups/?name=${encodeURIComponent(name)}`,
    );
    if (!result.ok) return result;
    const first = result.data.results[0];
    return { ok: true as const, data: first ?? null };
  },

  addUserToGroup: async (groupPk: AuthentikGroupPk, userPk: AuthentikUserPk) =>
    request<undefined>(config, "POST", `/api/v3/core/groups/${groupPk}/add_user/`, { pk: userPk }),

  removeUserFromGroup: async (groupPk: AuthentikGroupPk, userPk: AuthentikUserPk) =>
    request<undefined>(config, "POST", `/api/v3/core/groups/${groupPk}/remove_user/`, {
      pk: userPk,
    }),

  listUserGroups: async (userPk: AuthentikUserPk) => {
    type UserWithGroups = UserResponse & {
      readonly groups_obj: readonly GroupSummary[];
    };
    const result = await request<UserWithGroups>(
      config,
      "GET",
      `/api/v3/core/users/${userPk}/?include_groups=true`,
    );
    if (!result.ok) return result;
    return { ok: true as const, data: result.data.groups_obj };
  },

  // ── Service Account (M2M) ────────────────────────────────────

  createServiceAccount: async (input: CreateServiceAccountInput) =>
    request<ServiceAccountResponse>(config, "POST", "/api/v3/core/users/service_account/", {
      name: input.name,
      create_group: input.create_group ?? false,
      expiring: input.expiring ?? true,
      ...(input.expires !== undefined ? { expires: input.expires } : {}),
    }),
});

// ─── Noop client (testes ou IdP desabilitado) ───────────────────

export const createNoopAuthentikClient = (): AuthentikClient => {
  const stubUser = (overrides: Partial<UserResponse> = {}): UserResponse => ({
    pk: 0,
    uid: "noop-" + crypto.randomUUID(),
    username: "noop",
    name: "Noop User",
    email: "noop@example.invalid",
    is_active: true,
    is_superuser: false,
    groups: [],
    attributes: {},
    date_joined: new Date().toISOString(),
    last_login: null,
    ...overrides,
  });

  return {
    createUser: async (input) => ({
      ok: true,
      data: stubUser({
        username: input.username,
        name: input.name,
        email: input.email,
      }),
    }),
    getUser: async (pk) => ({ ok: true, data: stubUser({ pk }) }),
    findUserByUsername: async () => ({ ok: true, data: null }),
    findUserByUid: async () => ({ ok: true, data: null }),
    setPassword: async () => ({ ok: true, data: undefined }),
    deactivateUser: async () => ({ ok: true, data: undefined }),
    reactivateUser: async () => ({ ok: true, data: undefined }),
    deleteUser: async () => ({ ok: true, data: undefined }),
    updateUserAttributes: async (pk) => ({ ok: true, data: stubUser({ pk }) }),
    updateUserProfile: async (pk, patch) => ({
      ok: true,
      data: stubUser({
        pk,
        name: patch.name ?? "Noop User",
        email: patch.email ?? "noop@example.invalid",
      }),
    }),
    requestPasswordReset: async () => ({
      ok: true,
      data: { link: "https://noop.invalid/recovery/?token=noop" },
    }),
    findGroupByName: async () => ({ ok: true, data: null }),
    addUserToGroup: async () => ({ ok: true, data: undefined }),
    removeUserFromGroup: async () => ({ ok: true, data: undefined }),
    listUserGroups: async () => ({ ok: true, data: [] }),
    createServiceAccount: async (input) => ({
      ok: true,
      data: {
        username: input.name,
        token: "noop-token-" + crypto.randomUUID(),
        user_uid: "noop-" + crypto.randomUUID(),
        user_pk: 0,
      },
    }),
  };
};
