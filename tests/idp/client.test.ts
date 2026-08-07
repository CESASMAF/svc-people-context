import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";

import { createIdpClient, createNoopIdpClient } from "../../src/idp/index.ts";
import type { IdpUserId } from "../../src/idp/index.ts";

// ─── Mock de fetch (Kratos Admin API) ──────────────────────────
//
// A Admin API do Kratos usa read-modify-write (GET + PUT) em varias operacoes,
// entao o mock recebe cada request (metodo + url + body ja parseado) e o teste
// decide a resposta. `captured` guarda o historico para os asserts.

// Rede de seguranca do isolamento: cada `it` chama `restore()` no fim, mas um teste que falha
// (ou lanca) ANTES dessa linha deixa o mock instalado e contamina os seguintes — inclusive o
// bloco "smoke contra Kratos real", que passa a bater no mock em vez do Kratos e falha com dados
// do fixture ("joao@x.com"). Guardar o fetch nativo aqui e restaura-lo depois de CADA teste torna
// o isolamento independente do caminho feliz.
const NATIVE_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = NATIVE_FETCH;
});

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown> | undefined;
}

interface MockResponse {
  readonly status: number;
  readonly body: unknown; // objeto → JSON; string → texto cru
}

const installFetch = (
  handler: (req: CapturedRequest) => MockResponse,
): { captured: CapturedRequest[]; restore: () => void } => {
  const original = globalThis.fetch;
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const raw = init?.body;
    const body = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    const req: CapturedRequest = { url: String(url), method, body };
    captured.push(req);
    const res = handler(req);
    if (res.status === 204) return new Response(null, { status: 204 });
    const isString = typeof res.body === "string";
    return new Response(isString ? (res.body as string) : JSON.stringify(res.body), {
      status: res.status,
      headers: { "Content-Type": isString ? "text/plain" : "application/json" },
    });
  }) as unknown as typeof fetch;
  return { captured, restore: () => (globalThis.fetch = original) };
};

// Identity Kratos de referencia (shape minimo que o client consome).
const identity = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "11111111-1111-1111-1111-111111111111",
  schema_id: "person_v1",
  state: "active",
  // `traits.name` e OBJETO no schema `person_v1` do Kratos — string faz o Admin API responder 400.
  traits: { email: "joao@x.com", name: { first: "Joao", last: "Silva" } },
  metadata_public: { roles: [], username: "joao" },
  created_at: "2026-05-13T00:00:00Z",
  ...overrides,
});

describe("createIdpClient (unit, fetch mockado)", () => {
  it("createUser: POST /admin/identities com corpo Kratos e mapeia a identity", async () => {
    const { captured, restore } = installFetch(() => ({
      status: 201,
      body: identity({
        metadata_public: { roles: ["social-care:admin"], username: "joao", person_id: "p-1" },
      }),
    }));

    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.createUser({
      username: "joao",
      name: "Joao Silva", // nome completo: o adapter divide em first/last
      email: "joao@x.com",
      groups: ["social-care:admin"],
      attributes: { person_id: "p-1" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe("11111111-1111-1111-1111-111111111111");
      expect(result.data.username).toBe("joao");
      expect(result.data.email).toBe("joao@x.com");
      expect(result.data.active).toBe(true);
      expect(result.data.groups).toEqual(["social-care:admin"]);
      expect(result.data.attributes.person_id).toBe("p-1");
    }

    const req = captured[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://x/admin/identities");
    const body = req.body!;
    expect(body.schema_id).toBe("person_v1");
    expect(body.state).toBe("active");
    // nome completo do dominio → { first, last } exigido pelo schema `person_v1`.
    expect(body.traits).toEqual({ email: "joao@x.com", name: { first: "Joao", last: "Silva" } });
    const md = body.metadata_public as Record<string, unknown>;
    expect(md.roles).toEqual(["social-care:admin"]);
    expect(md.username).toBe("joao");
    expect(md.person_id).toBe("p-1");
    expect("credentials" in body).toBe(false); // sem password
    restore();
  });

  it("createUser: is_active=false vira state inactive", async () => {
    const { captured, restore } = installFetch(() => ({
      status: 201,
      body: identity({ state: "inactive" }),
    }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.createUser({
      username: "joao",
      name: "Joao",
      email: "joao@x.com",
      is_active: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.active).toBe(false);
    expect(captured[0]!.body!.state).toBe("inactive");
    restore();
  });

  it("createUser: password vai em credentials.password.config.password", async () => {
    const { captured, restore } = installFetch(() => ({ status: 201, body: identity() }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    await client.createUser({
      username: "joao",
      name: "Joao",
      email: "joao@x.com",
      password: "Secret123!",
    });
    const creds = captured[0]!.body!.credentials as {
      password: { config: { password: string } };
    };
    expect(creds.password.config.password).toBe("Secret123!");
    restore();
  });

  it("getUser: GET /admin/identities/{id} e mapeia state → active", async () => {
    const { captured, restore } = installFetch(() => ({
      status: 200,
      body: identity({ state: "inactive" }),
    }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.getUser("11111111-1111-1111-1111-111111111111");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.active).toBe(false);
    expect(captured[0]!.method).toBe("GET");
    expect(captured[0]!.url).toBe("http://x/admin/identities/11111111-1111-1111-1111-111111111111");
    restore();
  });

  it("getUser: propaga erro do request", async () => {
    const { restore } = installFetch(() => ({ status: 404, body: { error: { message: "gone" } } }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.getUser("id-x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(404);
    restore();
  });

  it("findUserByEmail: GET com credentials_identifier, resposta ARRAY → primeiro user", async () => {
    const { captured, restore } = installFetch(() => ({ status: 200, body: [identity()] }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.findUserByEmail("joao@x.com");
    expect(result.ok).toBe(true);
    if (result.ok && result.data) expect(result.data.email).toBe("joao@x.com");
    expect(captured[0]!.url).toContain("credentials_identifier=joao%40x.com");
    restore();
  });

  it("findUserByEmail: array vazio → null", async () => {
    const { restore } = installFetch(() => ({ status: 200, body: [] }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.findUserByEmail("nao@existe.com");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
    restore();
  });

  it("findUserByEmail: propaga erro do request", async () => {
    const { restore } = installFetch(() => ({ status: 500, body: { message: "boom" } }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.findUserByEmail("x@x.com");
    expect(result.ok).toBe(false);
    restore();
  });

  it("setPassword: GET + PUT com credentials, retorna ok", async () => {
    const { captured, restore } = installFetch(() => ({ status: 200, body: identity() }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.setPassword("id-1", "nova-senha");
    expect(result.ok).toBe(true);
    expect(captured[0]!.method).toBe("GET");
    expect(captured[1]!.method).toBe("PUT");
    const creds = captured[1]!.body!.credentials as {
      password: { config: { password: string } };
    };
    expect(creds.password.config.password).toBe("nova-senha");
    restore();
  });

  it("setPassword: propaga erro do PUT", async () => {
    const { restore } = installFetch((req) =>
      req.method === "GET"
        ? { status: 200, body: identity() }
        : { status: 400, body: { error: { reason: "weak" } } },
    );
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.setPassword("id-1", "x");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(400);
      expect(result.message).toBe("weak");
    }
    restore();
  });

  it("setPassword: propaga erro do GET inicial (sem PUT)", async () => {
    const { captured, restore } = installFetch(() => ({ status: 404, body: { message: "no id" } }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.setPassword("id-x", "x");
    expect(result.ok).toBe(false);
    expect(captured.length).toBe(1); // GET falhou → nao faz PUT
    restore();
  });

  it("deactivateUser/reactivateUser: read-modify-write troca o state e retorna void", async () => {
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });

    const off = installFetch((req) => ({
      status: 200,
      body: identity({ state: req.method === "PUT" ? "inactive" : "active" }),
    }));
    const deOk = await client.deactivateUser("id-1");
    expect(deOk.ok).toBe(true);
    expect(off.captured[1]!.method).toBe("PUT");
    expect(off.captured[1]!.body!.state).toBe("inactive");
    off.restore();

    const on = installFetch(() => ({ status: 200, body: identity() }));
    const reOk = await client.reactivateUser("id-1");
    expect(reOk.ok).toBe(true);
    expect(on.captured[1]!.body!.state).toBe("active");
    on.restore();
  });

  it("deactivateUser: propaga erro", async () => {
    const { restore } = installFetch(() => ({ status: 500, body: { message: "down" } }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.deactivateUser("id-1");
    expect(result.ok).toBe(false);
    restore();
  });

  it("deleteUser: DELETE 204 → ok", async () => {
    const { captured, restore } = installFetch(() => ({ status: 204, body: "" }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.deleteUser("id-1");
    expect(result.ok).toBe(true);
    expect(captured[0]!.method).toBe("DELETE");
    expect(captured[0]!.url).toBe("http://x/admin/identities/id-1");
    restore();
  });

  it("updateUserAttributes: GET + PUT preservando groups/username, retorna user", async () => {
    const { captured, restore } = installFetch((req) =>
      req.method === "GET"
        ? {
            status: 200,
            body: identity({
              metadata_public: { roles: ["social-care:admin"], username: "ana" },
            }),
          }
        : {
            status: 200,
            body: identity({
              metadata_public: {
                roles: ["social-care:admin"],
                username: "ana",
                org_id: "acdg-default",
                person_id: "p-1",
              },
            }),
          },
    );
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.updateUserAttributes("id-1", {
      org_id: "acdg-default",
      person_id: "p-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.attributes.org_id).toBe("acdg-default");
      expect(result.data.groups).toEqual(["social-care:admin"]);
    }
    // O PUT preserva groups/username e grava os novos atributos.
    const md = captured[1]!.body!.metadata_public as Record<string, unknown>;
    expect(md.roles).toEqual(["social-care:admin"]);
    expect(md.username).toBe("ana");
    expect(md.org_id).toBe("acdg-default");
    restore();
  });

  it("updateUserProfile: envia apenas os campos presentes no patch", async () => {
    const { captured, restore } = installFetch((req) =>
      req.method === "GET"
        ? { status: 200, body: identity({ traits: { email: "ana@x.com", name: { first: "Ana", last: "Antiga" } } }) }
        : {
            status: 200,
            body: identity({ traits: { email: "ana@x.com", name: { first: "Ana", last: "Nova" } } }),
          },
    );
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.updateUserProfile("id-1", { name: "Ana Nova" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name).toBe("Ana Nova");
    const traits = captured[1]!.body!.traits as Record<string, unknown>;
    // nome completo do patch e traduzido para o objeto exigido pelo schema `person_v1`.
    expect(traits.name).toEqual({ first: "Ana", last: "Nova" });
    expect(traits.email).toBe("ana@x.com"); // preservado do GET
    restore();
  });

  it("updateUserProfile: propaga erro do request", async () => {
    const { restore } = installFetch(() => ({ status: 500, body: { message: "boom" } }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.updateUserProfile("id-1", { name: "x" });
    expect(result.ok).toBe(false);
    restore();
  });

  // `code` e nao `link`: a stack habilita `selfservice.methods.code` e mantem `link` desligado —
  // bater em /admin/recovery/link devolve 404 "endpoint disabled by system administrator".
  it("requestPasswordReset: POST /admin/recovery/code → mapeia recovery_link para link", async () => {
    const { captured, restore } = installFetch(() => ({
      status: 200,
      body: { recovery_link: "https://auth.example/recovery?token=abc", recovery_code: "123456" },
    }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.requestPasswordReset("id-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.link).toBe("https://auth.example/recovery?token=abc");
    expect(captured[0]!.url).toBe("http://x/admin/recovery/code");
    expect(captured[0]!.body!.identity_id).toBe("id-1");
    restore();
  });

  it("requestPasswordReset: propaga erro do request", async () => {
    const { restore } = installFetch(() => ({ status: 500, body: { message: "boom" } }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.requestPasswordReset("id-1");
    expect(result.ok).toBe(false);
    restore();
  });

  it("addUserToGroup: adiciona a chave em metadata_public.groups (read-modify-write)", async () => {
    const { captured, restore } = installFetch((req) =>
      req.method === "GET"
        ? { status: 200, body: identity({ metadata_public: { roles: [], username: "ana" } }) }
        : {
            status: 200,
            body: identity({
              metadata_public: { roles: ["social-care:admin"], username: "ana" },
            }),
          },
    );
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.addUserToGroup("social-care:admin", "id-1");
    expect(result.ok).toBe(true);
    const md = captured[1]!.body!.metadata_public as Record<string, unknown>;
    expect(md.roles).toEqual(["social-care:admin"]);
    restore();
  });

  it("removeUserFromGroup: remove a chave de metadata_public.groups", async () => {
    const { captured, restore } = installFetch((req) =>
      req.method === "GET"
        ? {
            status: 200,
            body: identity({
              metadata_public: {
                roles: ["social-care:admin", "social-care:worker"],
                username: "ana",
              },
            }),
          }
        : {
            status: 200,
            body: identity({
              metadata_public: { roles: ["social-care:worker"], username: "ana" },
            }),
          },
    );
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.removeUserFromGroup("social-care:admin", "id-1");
    expect(result.ok).toBe(true);
    const md = captured[1]!.body!.metadata_public as Record<string, unknown>;
    expect(md.roles).toEqual(["social-care:worker"]);
    restore();
  });

  it("listUserGroups: le metadata_public.groups da identity", async () => {
    const { restore } = installFetch(() => ({
      status: 200,
      body: identity({
        metadata_public: {
          roles: ["social-care:admin", "social-care:worker"],
          username: "ana",
        },
      }),
    }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.listUserGroups("id-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBe(2);
      expect(result.data[0]).toBe("social-care:admin");
    }
    restore();
  });

  it("listUserGroups: propaga erro do request", async () => {
    const { restore } = installFetch(() => ({ status: 500, body: { message: "boom" } }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.listUserGroups("id-1");
    expect(result.ok).toBe(false);
    restore();
  });

  it("converte 204 No Content em Result ok (delete)", async () => {
    const { restore } = installFetch(() => ({ status: 204, body: "" }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    expect((await client.deleteUser("id-1")).ok).toBe(true);
    restore();
  });

  it("converte network error em Result error code 0", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.getUser("id-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(0);
      expect(result.message).toBe("ECONNREFUSED");
    }
    globalThis.fetch = original;
  });

  it("erro com body nao-JSON cai no fallback (retorna texto cru)", async () => {
    const { restore } = installFetch(() => ({ status: 500, body: "plain text error" }));
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });
    const result = await client.getUser("id-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(500);
      expect(result.message).toBe("plain text error");
    }
    restore();
  });

  it("erro com JSON usa error.reason > error.message > message", async () => {
    const client = createIdpClient({ baseUrl: "http://x", token: "t" });

    const r1 = installFetch(() => ({ status: 409, body: { error: { reason: "conflict!" } } }));
    const res1 = await client.getUser("id-1");
    if (!res1.ok) expect(res1.message).toBe("conflict!");
    r1.restore();

    const r2 = installFetch(() => ({ status: 400, body: { error: { message: "bad" } } }));
    const res2 = await client.getUser("id-1");
    if (!res2.ok) expect(res2.message).toBe("bad");
    r2.restore();

    const r3 = installFetch(() => ({ status: 400, body: { message: "top-level" } }));
    const res3 = await client.getUser("id-1");
    if (!res3.ok) expect(res3.message).toBe("top-level");
    r3.restore();
  });

  it("envia Authorization Bearer quando token esta configurado", async () => {
    const original = globalThis.fetch;
    const holder: { auth: string | null } = { auth: null };
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      holder.auth = new Headers(init?.headers).get("Authorization");
      return new Response(JSON.stringify(identity()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = createIdpClient({ baseUrl: "http://x", token: "secret-token" });
    await client.getUser("id-1");
    expect(holder.auth).toBe("Bearer secret-token");
    globalThis.fetch = original;
  });
});

// ─── Noop client ───────────────────────────────────────────────

describe("createNoopIdpClient", () => {
  it("retorna sucesso para todas as operacoes (uso em testes)", async () => {
    const client = createNoopIdpClient();

    const create = await client.createUser({
      username: "test",
      name: "Test",
      email: "test@example.com",
    });
    expect(create.ok).toBe(true);
    if (create.ok) expect(create.data.username).toBe("test");

    const recovery = await client.requestPasswordReset("id-1");
    expect(recovery.ok).toBe(true);
    if (recovery.ok) expect(recovery.data.link).toContain("noop");

    expect((await client.getUser("id-1")).ok).toBe(true);
    expect((await client.findUserByEmail("x@y.com")).ok).toBe(true);
    const byEmail = await client.findUserByEmail("x@y.com");
    if (byEmail.ok) expect(byEmail.data).toBeNull();
  });

  it("cobre mutacoes/roles retornando ok e listUserGroups vazio", async () => {
    const client = createNoopIdpClient();
    expect((await client.updateUserAttributes("id-1", { org_id: "x" })).ok).toBe(true);
    expect((await client.updateUserProfile("id-1", { name: "x", email: "y@z.com" })).ok).toBe(true);
    expect((await client.addUserToGroup("g", "id-1")).ok).toBe(true);
    expect((await client.removeUserFromGroup("g", "id-1")).ok).toBe(true);
    expect((await client.deleteUser("id-1")).ok).toBe(true);
    expect((await client.deactivateUser("id-1")).ok).toBe(true);
    expect((await client.reactivateUser("id-1")).ok).toBe(true);
    expect((await client.setPassword("id-1", "x")).ok).toBe(true);
    const groups = await client.listUserGroups("id-1");
    expect(groups.ok).toBe(true);
    if (groups.ok) expect(groups.data).toEqual([]);
  });
});

// ─── Smoke tests contra Kratos Admin real ──────────────────────
//
// Pulados se KRATOS_ADMIN_URL nao setado. Para rodar:
//   KRATOS_ADMIN_URL=http://localhost:4434 bun test tests/idp/

const KRATOS_ADMIN_URL = process.env["KRATOS_ADMIN_URL"];
const KRATOS_ADMIN_TOKEN = process.env["KRATOS_ADMIN_TOKEN"];
const live = KRATOS_ADMIN_URL !== undefined;

describe.skipIf(!live)("createIdpClient (smoke contra Kratos real)", () => {
  const client = createIdpClient({
    baseUrl: KRATOS_ADMIN_URL ?? "",
    ...(KRATOS_ADMIN_TOKEN !== undefined ? { token: KRATOS_ADMIN_TOKEN } : {}),
  });

  let userId: IdpUserId | undefined;
  const email = `acdg-smoke-${Date.now()}@example.test`;

  afterAll(async () => {
    if (userId !== undefined) await client.deleteUser(userId);
  });

  beforeAll(async () => {
    const created = await client.createUser({
      username: `smoke-${Date.now()}`,
      name: "Smoke Test",
      email,
      attributes: { org_id: "acdg-default", person_id: "01HXTEST" },
      password: "Sup3rSecret!",
    });
    expect(created.ok).toBe(true);
    if (created.ok) userId = created.data.id;
  });

  it("getUser recupera por id", async () => {
    if (userId === undefined) throw new Error("user nao criado");
    const result = await client.getUser(userId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.email).toBe(email);
  });

  it("findUserByEmail encontra por identifier", async () => {
    const result = await client.findUserByEmail(email);
    expect(result.ok).toBe(true);
    if (result.ok && result.data) expect(result.data.email).toBe(email);
  });

  it("updateUserAttributes persiste org_id + person_id", async () => {
    if (userId === undefined) throw new Error("user nao criado");
    const result = await client.updateUserAttributes(userId, {
      org_id: "acdg-default",
      person_id: "01HXTEST2",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.attributes.person_id).toBe("01HXTEST2");
  });

  it("addUserToGroup + listUserGroups + removeUserFromGroup", async () => {
    if (userId === undefined) throw new Error("user nao criado");
    const add = await client.addUserToGroup("social-care:worker", userId);
    expect(add.ok).toBe(true);

    const list = await client.listUserGroups(userId);
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.data).toContain("social-care:worker");

    const remove = await client.removeUserFromGroup("social-care:worker", userId);
    expect(remove.ok).toBe(true);
  });

  it("deactivateUser + reactivateUser idempotentes", async () => {
    if (userId === undefined) throw new Error("user nao criado");
    const off = await client.deactivateUser(userId);
    expect(off.ok).toBe(true);
    const check1 = await client.getUser(userId);
    if (check1.ok) expect(check1.data.active).toBe(false);

    const on = await client.reactivateUser(userId);
    expect(on.ok).toBe(true);
    const check2 = await client.getUser(userId);
    if (check2.ok) expect(check2.data.active).toBe(true);
  });

  it("requestPasswordReset retorna link de recovery", async () => {
    if (userId === undefined) throw new Error("user nao criado");
    const result = await client.requestPasswordReset(userId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.link.length).toBeGreaterThan(0);
  });
});
