import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createAuthentikClient, createNoopAuthentikClient } from "../../src/idp/index.ts";
import type { AuthentikUserPk } from "../../src/idp/index.ts";

// ─── Unit tests com fetch mockado ──────────────────────────────

describe("createAuthentikClient (unit, fetch mockado)", () => {
  const setupMockFetch = (response: {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  }) => {
    const original = globalThis.fetch;
    const mocked = (async () => {
      const isJson = typeof response.body !== "string";
      const body = isJson ? JSON.stringify(response.body) : (response.body as string);
      return new Response(body, {
        status: response.status,
        headers: { "Content-Type": "application/json", ...response.headers },
      });
    }) as unknown as typeof fetch;
    globalThis.fetch = mocked;
    return () => {
      globalThis.fetch = original;
    };
  };

  it("converte 200 + JSON em Result ok", async () => {
    const restore = setupMockFetch({
      status: 200,
      body: {
        pk: 42,
        uid: "abc123",
        username: "joao",
        name: "Joao",
        email: "j@x.com",
        is_active: true,
        is_superuser: false,
        groups: [],
        attributes: {},
        date_joined: "2026-05-13T00:00:00Z",
        last_login: null,
      },
    });

    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.getUser(42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.pk).toBe(42);
      expect(result.data.username).toBe("joao");
    }
    restore();
  });

  it("converte 204 No Content em Result ok com data undefined", async () => {
    const restore = setupMockFetch({
      status: 204,
      body: "",
      headers: { "content-length": "0" },
    });

    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.setPassword(1, "nova-senha");

    expect(result.ok).toBe(true);
    restore();
  });

  it("converte 4xx em Result error com code e message do detail/error_description", async () => {
    const restore = setupMockFetch({
      status: 415,
      body: { detail: "Tipo de mídia não suportado." },
    });

    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.getUser(1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(415);
      expect(result.message).toBe("Tipo de mídia não suportado.");
    }
    restore();
  });

  it("converte network error em Result error code 0", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.getUser(1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(0);
      expect(result.message).toBe("ECONNREFUSED");
    }
    globalThis.fetch = original;
  });

  it("findUserByUsername retorna null quando results vazio", async () => {
    const restore = setupMockFetch({
      status: 200,
      body: { results: [], pagination: { count: 0 } },
    });

    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.findUserByUsername("nao-existe");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
    restore();
  });

  it("findGroupByName retorna o primeiro group encontrado", async () => {
    const restore = setupMockFetch({
      status: 200,
      body: {
        results: [{ pk: "uuid-1", name: "social_worker", is_superuser: false }],
        pagination: { count: 1 },
      },
    });

    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.findGroupByName("social_worker");

    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.pk).toBe("uuid-1");
      expect(result.data.name).toBe("social_worker");
    }
    restore();
  });

  it("findGroupByName retorna null com results vazio", async () => {
    const restore = setupMockFetch({
      status: 200,
      body: { results: [], pagination: { count: 0 } },
    });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.findGroupByName("ghost");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
    restore();
  });

  it("findGroupByName propaga erro do request", async () => {
    const restore = setupMockFetch({ status: 500, body: { detail: "boom" } });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.findGroupByName("x");
    expect(result.ok).toBe(false);
    restore();
  });

  it("findUserByUid retorna user encontrado e null quando vazio", async () => {
    const restore1 = setupMockFetch({
      status: 200,
      body: {
        results: [
          {
            pk: 7,
            uid: "u-7",
            username: "joao",
            name: "J",
            email: "j@x.com",
            is_active: true,
            is_superuser: false,
            groups: [],
            attributes: {},
            date_joined: "2026-01-01T00:00:00Z",
            last_login: null,
          },
        ],
        pagination: { count: 1 },
      },
    });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const found = await client.findUserByUid("u-7");
    expect(found.ok).toBe(true);
    if (found.ok && found.data) expect(found.data.pk).toBe(7);
    restore1();

    const restore2 = setupMockFetch({
      status: 200,
      body: { results: [], pagination: { count: 0 } },
    });
    const empty = await client.findUserByUid("u-x");
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.data).toBeNull();
    restore2();
  });

  it("findUserByUid propaga erro do request", async () => {
    const restore = setupMockFetch({ status: 503, body: { detail: "down" } });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.findUserByUid("u-1");
    expect(result.ok).toBe(false);
    restore();
  });

  it("findUserByUsername propaga erro do request", async () => {
    const restore = setupMockFetch({ status: 500, body: { detail: "boom" } });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.findUserByUsername("x");
    expect(result.ok).toBe(false);
    restore();
  });

  it("createUser POST com defaults aplicados", async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          pk: 1,
          uid: "u-1",
          username: "test",
          name: "Test",
          email: "t@x.com",
          is_active: true,
          is_superuser: false,
          groups: [],
          attributes: {},
          date_joined: "2026-01-01T00:00:00Z",
          last_login: null,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.createUser({ username: "test", name: "Test", email: "t@x.com" });

    expect(result.ok).toBe(true);
    expect(captured).not.toBeNull();
    const body = JSON.parse(captured!.init!.body as string) as Record<string, unknown>;
    expect(body.is_active).toBe(true);
    expect(body.path).toBe("users");
    expect(body.type).toBe("internal");
    expect(body.groups).toEqual([]);
    globalThis.fetch = original;
  });

  it("setPassword retorna ok mesmo com body nao-vazio (descartado)", async () => {
    const restore = setupMockFetch({ status: 200, body: { something: "ignored" } });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.setPassword(1, "x");
    expect(result.ok).toBe(true);
    restore();
  });

  it("setPassword propaga erro", async () => {
    const restore = setupMockFetch({ status: 400, body: { detail: "weak" } });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.setPassword(1, "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(400);
    restore();
  });

  it("deactivateUser/reactivateUser retornam void em ok e propagam erro", async () => {
    const restoreOk = setupMockFetch({ status: 200, body: { pk: 1 } });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    expect((await client.deactivateUser(1)).ok).toBe(true);
    expect((await client.reactivateUser(1)).ok).toBe(true);
    restoreOk();

    const restoreErr = setupMockFetch({ status: 404, body: { detail: "not found" } });
    expect((await client.deactivateUser(1)).ok).toBe(false);
    expect((await client.reactivateUser(1)).ok).toBe(false);
    restoreErr();
  });

  it("deleteUser via DELETE retorna ok em 204", async () => {
    const restore = setupMockFetch({ status: 204, body: "", headers: { "content-length": "0" } });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.deleteUser(1);
    expect(result.ok).toBe(true);
    restore();
  });

  it("updateUserAttributes retorna user atualizado", async () => {
    const restore = setupMockFetch({
      status: 200,
      body: {
        pk: 5,
        uid: "u-5",
        username: "ana",
        name: "Ana",
        email: "a@x.com",
        is_active: true,
        is_superuser: false,
        groups: [],
        attributes: { org_id: "acdg-default", person_id: "p-1" },
        date_joined: "2026-01-01T00:00:00Z",
        last_login: null,
      },
    });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.updateUserAttributes(5, {
      org_id: "acdg-default",
      person_id: "p-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.attributes.org_id).toBe("acdg-default");
    restore();
  });

  it("updateUserProfile envia apenas os campos presentes no patch", async () => {
    let captured: { init?: RequestInit } | null = null;
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      captured = { init };
      return new Response(
        JSON.stringify({
          pk: 5,
          uid: "u-5",
          username: "ana",
          name: "Ana Nova",
          email: "nova@x.com",
          is_active: true,
          is_superuser: false,
          groups: [],
          attributes: {},
          date_joined: "2026-01-01T00:00:00Z",
          last_login: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.updateUserProfile(5, { name: "Ana Nova", email: "nova@x.com" });

    expect(result.ok).toBe(true);
    const body = JSON.parse(captured!.init!.body as string) as Record<string, unknown>;
    expect(body.name).toBe("Ana Nova");
    expect(body.email).toBe("nova@x.com");
    expect("attributes" in body).toBe(false); // ausente do patch → ausente do body
    globalThis.fetch = original;
  });

  it("updateUserProfile propaga erro do request", async () => {
    const restore = setupMockFetch({ status: 500, body: { detail: "boom" } });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.updateUserProfile(5, { name: "x" });
    expect(result.ok).toBe(false);
    restore();
  });

  it("requestPasswordReset retorna link", async () => {
    const restore = setupMockFetch({
      status: 200,
      body: { link: "https://auth.example/recovery?token=t" },
    });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.requestPasswordReset(1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.link).toContain("recovery");
    restore();
  });

  it("addUserToGroup/removeUserFromGroup retornam void em 204", async () => {
    const restore = setupMockFetch({ status: 204, body: "" });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    expect((await client.addUserToGroup("g-1", 1)).ok).toBe(true);
    expect((await client.removeUserFromGroup("g-1", 1)).ok).toBe(true);
    restore();
  });

  it("listUserGroups extrai groups_obj do user response", async () => {
    const restore = setupMockFetch({
      status: 200,
      body: {
        pk: 1,
        uid: "u-1",
        username: "ana",
        name: "Ana",
        email: "a@x.com",
        is_active: true,
        is_superuser: false,
        groups: [],
        attributes: {},
        date_joined: "2026-01-01T00:00:00Z",
        last_login: null,
        groups_obj: [
          { pk: "g-1", name: "social-care:admin", is_superuser: false },
          { pk: "g-2", name: "social-care:worker", is_superuser: false },
        ],
      },
    });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.listUserGroups(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBe(2);
      expect(result.data[0]!.name).toBe("social-care:admin");
    }
    restore();
  });

  it("listUserGroups propaga erro do request", async () => {
    const restore = setupMockFetch({ status: 500, body: { detail: "boom" } });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.listUserGroups(1);
    expect(result.ok).toBe(false);
    restore();
  });

  it("createServiceAccount retorna token + user_pk", async () => {
    const restore = setupMockFetch({
      status: 201,
      body: { username: "svc", token: "tok-abc", user_uid: "u-svc", user_pk: 99 },
    });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.createServiceAccount({
      name: "svc",
      create_group: true,
      expiring: true,
      expires: "2027-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.token).toBe("tok-abc");
      expect(result.data.user_pk).toBe(99);
    }
    restore();
  });

  it("erro com body nao-JSON cai no fallback do parse (retorna raw text)", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("plain text error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      })) as unknown as typeof fetch;

    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.getUser(1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(500);
      expect(result.message).toBe("plain text error");
    }
    globalThis.fetch = original;
  });

  it("erro com JSON sem detail usa error_description", async () => {
    const restore = setupMockFetch({
      status: 401,
      body: { error: "invalid_token", error_description: "Token expirado" },
    });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.getUser(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Token expirado");
    restore();
  });

  it("erro com JSON sem detail nem error_description usa campo error", async () => {
    const restore = setupMockFetch({
      status: 401,
      body: { error: "invalid_request" },
    });
    const client = createAuthentikClient({ baseUrl: "http://x", token: "t" });
    const result = await client.getUser(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("invalid_request");
    restore();
  });
});

describe("createNoopAuthentikClient — cobertura adicional", () => {
  it("findUserByUid e findUserByUsername retornam null", async () => {
    const { createNoopAuthentikClient } = await import("../../src/idp/index.ts");
    const client = createNoopAuthentikClient();
    expect((await client.findUserByUsername("x")).ok).toBe(true);
    expect((await client.findUserByUid("y")).ok).toBe(true);
  });

  it("listUserGroups retorna lista vazia", async () => {
    const { createNoopAuthentikClient } = await import("../../src/idp/index.ts");
    const client = createNoopAuthentikClient();
    const result = await client.listUserGroups(1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });

  it("updateUserAttributes + addUserToGroup + removeUserFromGroup + deleteUser retornam ok", async () => {
    const { createNoopAuthentikClient } = await import("../../src/idp/index.ts");
    const client = createNoopAuthentikClient();
    expect((await client.updateUserAttributes(1, { org_id: "x" })).ok).toBe(true);
    expect((await client.updateUserProfile(1, { name: "x", email: "y@z.com" })).ok).toBe(true);
    expect((await client.addUserToGroup("g", 1)).ok).toBe(true);
    expect((await client.removeUserFromGroup("g", 1)).ok).toBe(true);
    expect((await client.deleteUser(1)).ok).toBe(true);
    expect((await client.deactivateUser(1)).ok).toBe(true);
    expect((await client.reactivateUser(1)).ok).toBe(true);
    expect((await client.getUser(1)).ok).toBe(true);
    expect((await client.setPassword(1, "x")).ok).toBe(true);
  });
});

// ─── Noop client ───────────────────────────────────────────────

describe("createNoopAuthentikClient", () => {
  it("retorna sucesso para todas operacoes (uso em testes)", async () => {
    const client = createNoopAuthentikClient();

    const create = await client.createUser({
      username: "test",
      name: "Test",
      email: "test@example.com",
    });
    expect(create.ok).toBe(true);
    if (create.ok) expect(create.data.username).toBe("test");

    const recovery = await client.requestPasswordReset(1);
    expect(recovery.ok).toBe(true);
    if (recovery.ok) expect(recovery.data.link).toContain("noop");

    const sa = await client.createServiceAccount({ name: "svc-test" });
    expect(sa.ok).toBe(true);
    if (sa.ok) expect(sa.data.token).toContain("noop-token-");
  });
});

// ─── Smoke tests contra instancia local (auth-spike) ───────────
//
// Pulados se AUTHENTIK_URL nao setado. Para rodar:
//   AUTHENTIK_URL=http://localhost:9000 \
//   AUTHENTIK_TOKEN=<token do .env do spike> \
//     bun test tests/idp/

const AUTHENTIK_URL = process.env["AUTHENTIK_URL"];
const AUTHENTIK_TOKEN = process.env["AUTHENTIK_TOKEN"];
const live = AUTHENTIK_URL !== undefined && AUTHENTIK_TOKEN !== undefined;

describe.skipIf(!live)("createAuthentikClient (smoke contra instancia real)", () => {
  const client = createAuthentikClient({
    baseUrl: AUTHENTIK_URL ?? "",
    token: AUTHENTIK_TOKEN ?? "",
  });

  let saUserPk: AuthentikUserPk | undefined;
  const saName = `acdg-smoke-${Date.now()}`;

  beforeAll(async () => {
    // Garantir que existe um group `social_worker` (criado no spike)
    const group = await client.findGroupByName("social_worker");
    expect(group.ok).toBe(true);
  });

  afterAll(async () => {
    if (saUserPk !== undefined) {
      await client.deleteUser(saUserPk);
    }
  });

  it("createServiceAccount retorna token + user_pk", async () => {
    const result = await client.createServiceAccount({
      name: saName,
      create_group: false,
      expiring: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.username).toBe(saName);
      expect(result.data.token.length).toBeGreaterThan(20);
      expect(result.data.user_pk).toBeGreaterThan(0);
      saUserPk = result.data.user_pk;
    }
  });

  it("getUser recupera por pk", async () => {
    if (saUserPk === undefined) throw new Error("SA nao criada");
    const result = await client.getUser(saUserPk);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.username).toBe(saName);
    }
  });

  it("updateUserAttributes persiste org_id + person_id", async () => {
    if (saUserPk === undefined) throw new Error("SA nao criada");
    const result = await client.updateUserAttributes(saUserPk, {
      org_id: "acdg-default",
      person_id: "01HXTEST",
      legacy_zitadel_sub: "270366000000000000",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.attributes["org_id"]).toBe("acdg-default");
      expect(result.data.attributes["person_id"]).toBe("01HXTEST");
    }
  });

  it("addUserToGroup + listUserGroups + removeUserFromGroup", async () => {
    if (saUserPk === undefined) throw new Error("SA nao criada");

    const group = await client.findGroupByName("social_worker");
    expect(group.ok).toBe(true);
    if (!group.ok || !group.data) throw new Error("group social_worker nao existe");
    const groupPk = group.data.pk;

    const add = await client.addUserToGroup(groupPk, saUserPk);
    expect(add.ok).toBe(true);

    const list = await client.listUserGroups(saUserPk);
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.data.some((g) => g.name === "social_worker")).toBe(true);
    }

    const remove = await client.removeUserFromGroup(groupPk, saUserPk);
    expect(remove.ok).toBe(true);
  });

  it("deactivateUser + reactivateUser idempotentes", async () => {
    if (saUserPk === undefined) throw new Error("SA nao criada");

    const off = await client.deactivateUser(saUserPk);
    expect(off.ok).toBe(true);

    const check1 = await client.getUser(saUserPk);
    if (check1.ok) expect(check1.data.is_active).toBe(false);

    const on = await client.reactivateUser(saUserPk);
    expect(on.ok).toBe(true);

    const check2 = await client.getUser(saUserPk);
    if (check2.ok) expect(check2.data.is_active).toBe(true);
  });

  it("requestPasswordReset retorna link valido para o acdg-recovery-flow", async () => {
    if (saUserPk === undefined) throw new Error("SA nao criada");
    const result = await client.requestPasswordReset(saUserPk);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.link).toContain("/if/flow/acdg-recovery-flow/");
      expect(result.data.link).toContain("flow_token=");
    }
  });
});
