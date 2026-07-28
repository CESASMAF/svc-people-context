import type {
  ACDGUserAttributes,
  CreateUserInput,
  IdpClient,
  IdpResult,
  IdpUser,
  IdpUserId,
  RecoveryLinkResponse,
  UpdateUserProfileInput,
} from "./types.ts";

// ─── Config ────────────────────────────────────────────────────
//
// A Admin API do Kratos (:4434) NÃO exige autenticação — a proteção é a isolação
// de rede (malha `internal`). `token` é opcional: só é enviado se um proxy com
// Bearer for posto na frente do Admin (defesa-em-profundidade — follow-up).

interface IdpClientConfig {
  readonly baseUrl: string;
  readonly token?: string;
}

// ─── Kratos identity (shape mínimo que consumimos) ─────────────

interface KratosIdentity {
  readonly id: string;
  readonly schema_id: string;
  readonly state: "active" | "inactive";
  readonly traits: { readonly email?: string; readonly name?: string };
  readonly metadata_public?: Record<string, unknown> | null;
  readonly created_at?: string;
}

// Corpo do PUT /admin/identities/{id} (AdminUpdateIdentityBody).
interface KratosUpdateBody {
  readonly schema_id: string;
  readonly state: "active" | "inactive";
  readonly traits: Record<string, unknown>;
  readonly metadata_public: Record<string, unknown>;
  readonly credentials?: { readonly password: { readonly config: { readonly password: string } } };
}

// ─── HTTP helper (never throws — boundary do Result) ───────────
//
// try/catch existe APENAS aqui (boundary infra). Toda funcao publica devolve
// Result<T, E> em vez de propagar excecao. Conforme ADR-014 e regra do CLAUDE.md.

const request = async <T>(
  config: IdpClientConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<IdpResult<T>> => {
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        ...(config.token !== undefined ? { Authorization: `Bearer ${config.token}` } : {}),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // 204 No Content: caller usa T = undefined.
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
        error?: { message?: string; reason?: string };
        message?: string;
      };
      message = parsed.error?.reason ?? parsed.error?.message ?? parsed.message ?? errorBody;
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

// ─── Mapeamento identity → IdpUser ─────────────────────────────

const asStringArray = (v: unknown): readonly string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

const mapIdentity = (id: KratosIdentity): IdpUser => {
  const md = (id.metadata_public ?? {}) as Record<string, unknown>;
  // separa `groups`/`username` do restante (= atributos ACDG)
  const { groups, username, ...attributes } = md;
  return {
    id: id.id,
    username: typeof username === "string" ? username : "",
    name: id.traits.name ?? "",
    email: id.traits.email ?? "",
    active: id.state === "active",
    groups: asStringArray(groups),
    attributes: attributes as ACDGUserAttributes,
    createdAt: id.created_at ?? "",
  };
};

// Corpo base do PUT a partir da identity atual (preserva o que não muda).
const baseBody = (id: KratosIdentity): KratosUpdateBody => ({
  schema_id: id.schema_id,
  state: id.state,
  traits: { ...id.traits },
  metadata_public: { ...(id.metadata_public ?? {}) },
});

// ─── Factory ───────────────────────────────────────────────────

export const createIdpClient = (config: IdpClientConfig): IdpClient => {
  // GET a identity, aplica `mutate` e faz PUT (read-modify-write).
  const modify = async (
    id: IdpUserId,
    mutate: (current: KratosIdentity) => KratosUpdateBody,
  ): Promise<IdpResult<IdpUser>> => {
    const got = await request<KratosIdentity>(config, "GET", `/admin/identities/${id}`);
    if (!got.ok) return got;
    const put = await request<KratosIdentity>(
      config,
      "PUT",
      `/admin/identities/${id}`,
      mutate(got.data),
    );
    if (!put.ok) return put;
    return { ok: true, data: mapIdentity(put.data) };
  };

  const setState = async (
    id: IdpUserId,
    state: "active" | "inactive",
  ): Promise<IdpResult<undefined>> => {
    const result = await modify(id, (cur) => ({ ...baseBody(cur), state }));
    if (!result.ok) return result;
    return { ok: true, data: undefined };
  };

  const setGroups = async (
    id: IdpUserId,
    reduce: (current: readonly string[]) => readonly string[],
  ): Promise<IdpResult<undefined>> => {
    const result = await modify(id, (cur) => {
      const md = (cur.metadata_public ?? {}) as Record<string, unknown>;
      const next = [...new Set(reduce(asStringArray(md.groups)))];
      return { ...baseBody(cur), metadata_public: { ...md, groups: next } };
    });
    if (!result.ok) return result;
    return { ok: true, data: undefined };
  };

  return {
    // ── Users ────────────────────────────────────────────────────
    createUser: async (input: CreateUserInput) =>
      request<KratosIdentity>(config, "POST", "/admin/identities", {
        schema_id: "person_v1",
        state: input.is_active === false ? "inactive" : "active",
        traits: { email: input.email, name: input.name },
        metadata_public: {
          groups: input.groups ?? [],
          username: input.username,
          ...(input.attributes ?? {}),
        },
        ...(input.password !== undefined && input.password !== ""
          ? { credentials: { password: { config: { password: input.password } } } }
          : {}),
      }).then((r) => (r.ok ? { ok: true as const, data: mapIdentity(r.data) } : r)),

    getUser: async (id: IdpUserId) =>
      request<KratosIdentity>(config, "GET", `/admin/identities/${id}`).then((r) =>
        r.ok ? { ok: true as const, data: mapIdentity(r.data) } : r,
      ),

    findUserByEmail: async (email: string) => {
      const result = await request<KratosIdentity[]>(
        config,
        "GET",
        `/admin/identities?credentials_identifier=${encodeURIComponent(email)}`,
      );
      if (!result.ok) return result;
      const first = result.data[0];
      return { ok: true as const, data: first !== undefined ? mapIdentity(first) : null };
    },

    // Kratos não tem endpoint dedicado: PUT com credentials substitui a senha
    // (preserva traits/metadata/state via read-modify-write). Usado só no
    // provision de um user novo (sem TOTP) — seguro.
    setPassword: async (id: IdpUserId, password: string) => {
      const got = await request<KratosIdentity>(config, "GET", `/admin/identities/${id}`);
      if (!got.ok) return got;
      const put = await request<KratosIdentity>(config, "PUT", `/admin/identities/${id}`, {
        ...baseBody(got.data),
        credentials: { password: { config: { password } } },
      });
      if (!put.ok) return put;
      return { ok: true as const, data: undefined };
    },

    deactivateUser: async (id: IdpUserId) => setState(id, "inactive"),

    reactivateUser: async (id: IdpUserId) => setState(id, "active"),

    deleteUser: async (id: IdpUserId) =>
      request<undefined>(config, "DELETE", `/admin/identities/${id}`),

    updateUserAttributes: async (id: IdpUserId, attributes: ACDGUserAttributes) =>
      modify(id, (cur) => {
        const md = (cur.metadata_public ?? {}) as Record<string, unknown>;
        // preserva `groups`/`username`; sobrescreve só os atributos ACDG.
        return {
          ...baseBody(cur),
          metadata_public: {
            ...attributes,
            ...(md.groups !== undefined ? { groups: md.groups } : {}),
            ...(md.username !== undefined ? { username: md.username } : {}),
          },
        };
      }),

    updateUserProfile: async (id: IdpUserId, patch: UpdateUserProfileInput) =>
      modify(id, (cur) => ({
        ...baseBody(cur),
        traits: {
          ...cur.traits,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.email !== undefined ? { email: patch.email } : {}),
        },
        ...(patch.attributes !== undefined
          ? {
              metadata_public: {
                ...(cur.metadata_public ?? {}),
                ...patch.attributes,
              },
            }
          : {}),
      })),

    // ── Recovery ─────────────────────────────────────────────────
    requestPasswordReset: async (id: IdpUserId) => {
      const r = await request<{ recovery_link: string }>(config, "POST", "/admin/recovery/link", {
        identity_id: id,
      });
      if (!r.ok) return r;
      return {
        ok: true as const,
        data: { link: r.data.recovery_link } satisfies RecoveryLinkResponse,
      };
    },

    // ── Roles (metadata_public.groups) ──────────────────────────
    addUserToGroup: async (group: string, id: IdpUserId) => setGroups(id, (cur) => [...cur, group]),

    removeUserFromGroup: async (group: string, id: IdpUserId) =>
      setGroups(id, (cur) => cur.filter((g) => g !== group)),

    listUserGroups: async (id: IdpUserId) => {
      const r = await request<KratosIdentity>(config, "GET", `/admin/identities/${id}`);
      if (!r.ok) return r;
      return { ok: true as const, data: asStringArray(r.data.metadata_public?.groups) };
    },
  };
};

// ─── Noop client (testes ou IdP desabilitado) ───────────────────

export const createNoopIdpClient = (): IdpClient => {
  const stub = (overrides: Partial<IdpUser> = {}): IdpUser => ({
    id: "noop-" + crypto.randomUUID(),
    username: "noop",
    name: "Noop User",
    email: "noop@example.invalid",
    active: true,
    groups: [],
    attributes: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  return {
    createUser: async (input) => ({
      ok: true,
      data: stub({ username: input.username, name: input.name, email: input.email }),
    }),
    getUser: async (id) => ({ ok: true, data: stub({ id }) }),
    findUserByEmail: async () => ({ ok: true, data: null }),
    setPassword: async () => ({ ok: true, data: undefined }),
    deactivateUser: async () => ({ ok: true, data: undefined }),
    reactivateUser: async () => ({ ok: true, data: undefined }),
    deleteUser: async () => ({ ok: true, data: undefined }),
    updateUserAttributes: async (id) => ({ ok: true, data: stub({ id }) }),
    updateUserProfile: async (id, patch) => ({
      ok: true,
      data: stub({
        id,
        name: patch.name ?? "Noop User",
        email: patch.email ?? "noop@example.invalid",
      }),
    }),
    requestPasswordReset: async () => ({
      ok: true,
      data: { link: "https://noop.invalid/recovery/?token=noop" },
    }),
    addUserToGroup: async () => ({ ok: true, data: undefined }),
    removeUserFromGroup: async () => ({ ok: true, data: undefined }),
    listUserGroups: async () => ({ ok: true, data: [] }),
  };
};
