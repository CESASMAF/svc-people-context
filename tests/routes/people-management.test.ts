import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createPeopleRoutes } from "../../src/routes/people.ts";
import { createFakePersonRepository, createFakeRoleRepository } from "./fake-repositories.ts";
import { createFakeAuthGuard, createFakeAuthGuardWithRoles } from "./fake-auth.ts";
import { createFakePublisher } from "./fake-publisher.ts";
import { createFakeIdpClient, type FakeIdpOverrides } from "./fake-idp.ts";
import type { AuthGuard } from "../../src/middleware/auth.ts";
import { parseJson, dataAs, type IdData } from "./test-types.ts";

const setup = (opts: { idp?: FakeIdpOverrides; guard?: AuthGuard } = {}) => {
  const people = createFakePersonRepository();
  const roles = createFakeRoleRepository();
  const guard = opts.guard ?? createFakeAuthGuard();
  const publisher = createFakePublisher();
  const idp = createFakeIdpClient(opts.idp ?? {});
  const app = new Elysia().use(createPeopleRoutes({ people, roles, guard, publisher, idp }));
  return { app, people, publisher, idp };
};

const post = (body: unknown) => ({
  method: "POST" as const,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const put = (body: unknown) => ({
  method: "PUT" as const,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const createPerson = async (
  app: ReturnType<typeof setup>["app"],
  body: Record<string, unknown>,
): Promise<string> => {
  const res = await app.handle(new Request("http://localhost/api/v1/people", post(body)));
  return dataAs<IdData>(await parseJson(res)).id;
};

const url = (path: string) => `http://localhost/api/v1${path}`;

// ─── PUT /people/:id — sincronizacao de perfil com o IdP ────────

describe("PUT /api/v1/people/:personId — sync de perfil no IdP", () => {
  const withLogin = async (overrides: FakeIdpOverrides = {}) => {
    const ctx = setup({ idp: { createUserId: "id-55", ...overrides } });
    const personId = await createPerson(ctx.app, {
      fullName: "Ana Costa",
      birthDate: "1990-05-15",
      email: "ana@example.com",
      createLogin: true,
    });
    return { ...ctx, personId };
  };

  it("sincroniza name no IdP quando a pessoa tem login", async () => {
    const { app, idp, personId } = await withLogin();

    const res = await app.handle(
      new Request(
        url(`/people/${personId}`),
        put({ fullName: "Ana Nova", birthDate: "1990-05-15" }),
      ),
    );

    expect(res.status).toBe(204);
    expect(idp.calls.updateUserProfile.length).toBe(1);
    expect(idp.calls.updateUserProfile[0]!.id).toBe("id-55");
    expect(idp.calls.updateUserProfile[0]!.name).toBe("Ana Nova");
  });

  it("atualiza email e propaga ao IdP", async () => {
    const { app, idp, people, personId } = await withLogin();

    const res = await app.handle(
      new Request(
        url(`/people/${personId}`),
        put({
          fullName: "Ana Costa",
          birthDate: "1990-05-15",
          email: "ana.nova@example.com",
        }),
      ),
    );

    expect(res.status).toBe(204);
    expect(idp.calls.updateUserProfile[0]!.email).toBe("ana.nova@example.com");
    const stored = await people.findById(personId);
    expect(stored?.email).toBe("ana.nova@example.com");
  });

  it("nao chama updateUserProfile quando a pessoa nao tem login", async () => {
    const { app, idp } = setup();
    const personId = await createPerson(app, { fullName: "Sem Login", birthDate: "2000-01-01" });

    const res = await app.handle(
      new Request(url(`/people/${personId}`), put({ fullName: "Outro", birthDate: "2000-01-01" })),
    );

    expect(res.status).toBe(204);
    expect(idp.calls.updateUserProfile.length).toBe(0);
  });

  it("continua 204 mesmo se o sync de perfil falhar (best-effort)", async () => {
    const { app, personId } = await withLogin({
      updateProfileFails: { code: 500, message: "down" },
    });

    const res = await app.handle(
      new Request(url(`/people/${personId}`), put({ fullName: "Ana X", birthDate: "1990-05-15" })),
    );

    expect(res.status).toBe(204);
  });

  it("retorna 400 quando validacao falha (birthDate futura)", async () => {
    const { app, personId } = await withLogin();
    const res = await app.handle(
      new Request(url(`/people/${personId}`), put({ fullName: "Ana", birthDate: "3000-01-01" })),
    );
    expect(res.status).toBe(400);
    const body = (await parseJson(res)) as unknown as { error: { code: string } };
    expect(body.error.code).toBe("PEO-001");
  });

  it("retorna 404 quando a pessoa nao existe", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request(
        url("/people/00000000-0000-0000-0000-000000000000"),
        put({ fullName: "X", birthDate: "2000-01-01" }),
      ),
    );
    expect(res.status).toBe(404);
  });
});

// ─── POST /people/:id/login — provisionamento retroativo ────────

describe("POST /api/v1/people/:personId/login — login retroativo", () => {
  it("provisiona login para pessoa sem login usando o email do cadastro", async () => {
    const { app, people, publisher, idp } = setup({
      idp: { createUserId: "id-88" },
    });
    const personId = await createPerson(app, {
      fullName: "Bruno Lima",
      birthDate: "1985-03-10",
      email: "bruno@example.com",
    });

    const res = await app.handle(new Request(url(`/people/${personId}/login`), post({})));

    expect(res.status).toBe(201);
    expect(idp.calls.createUser.length).toBe(1);
    const stored = await people.findById(personId);
    expect(stored?.idpUserId).toBe("id-88");
    expect(publisher.published.map((p) => p.subject)).toContain("people.user.provisioned");
  });

  it("aceita email e senha no body (override) ", async () => {
    const { app, idp } = setup({ idp: { createUserId: "id-89" } });
    const personId = await createPerson(app, { fullName: "Sem Email", birthDate: "2000-01-01" });

    const res = await app.handle(
      new Request(
        url(`/people/${personId}/login`),
        post({ email: "novo@example.com", initialPassword: "Secret123!" }),
      ),
    );

    expect(res.status).toBe(201);
    // A senha vai direto no createUser (credentials do Kratos), nao em setPassword.
    expect(idp.calls.createUser[0]?.password).toBe("Secret123!");
    expect(idp.calls.createUser[0]?.email).toBe("novo@example.com");
  });

  it("retorna 409 quando a pessoa ja tem login", async () => {
    const { app } = setup({ idp: { createUserId: "id-90" } });
    const personId = await createPerson(app, {
      fullName: "Com Login",
      birthDate: "2000-01-01",
      email: "com@example.com",
      createLogin: true,
    });

    const res = await app.handle(new Request(url(`/people/${personId}/login`), post({})));
    expect(res.status).toBe(409);
    const body = (await parseJson(res)) as unknown as { error: { code: string } };
    expect(body.error.code).toBe("PEO-008");
  });

  it("retorna 422 quando nao ha email disponivel", async () => {
    const { app } = setup();
    const personId = await createPerson(app, { fullName: "Sem Email", birthDate: "2000-01-01" });

    const res = await app.handle(new Request(url(`/people/${personId}/login`), post({})));
    expect(res.status).toBe(422);
    const body = (await parseJson(res)) as unknown as { error: { code: string } };
    expect(body.error.code).toBe("PEO-009");
  });

  it("retorna 404 quando a pessoa nao existe", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request(
        url("/people/00000000-0000-0000-0000-000000000000/login"),
        post({ email: "x@y.com" }),
      ),
    );
    expect(res.status).toBe(404);
  });

  it("retorna 400 quando personId nao e UUID", async () => {
    const { app } = setup();
    const res = await app.handle(new Request(url("/people/not-a-uuid/login"), post({})));
    expect(res.status).toBe(400);
  });

  it("retorna 502 com IDP-001 quando o provisionamento falha", async () => {
    const { app, people } = setup({ idp: { createUserFails: { code: 500, message: "idp down" } } });
    const personId = await createPerson(app, {
      fullName: "Falha",
      birthDate: "2000-01-01",
      email: "falha@example.com",
    });

    const res = await app.handle(new Request(url(`/people/${personId}/login`), post({})));
    expect(res.status).toBe(502);
    const body = (await parseJson(res)) as unknown as { error: { code: string; message: string } };
    expect(body.error.code).toBe("IDP-001");
    expect(body.error.message).not.toContain("idp down");
    const stored = await people.findById(personId);
    expect(stored?.idpUserId).toBeNull();
  });
});

// ─── DELETE /people/:id — erasure (LGPD Art. 18 V) ──────────────

describe("DELETE /api/v1/people/:personId — erasure", () => {
  const superadmin = () => createFakeAuthGuardWithRoles(["superadmin"]);

  const withLogin = async (overrides: FakeIdpOverrides = {}) => {
    const ctx = setup({
      idp: { createUserId: "id-33", ...overrides },
      guard: superadmin(),
    });
    const personId = await createPerson(ctx.app, {
      fullName: "Carla Dias",
      birthDate: "1992-07-20",
      email: "carla@example.com",
      createLogin: true,
    });
    return { ...ctx, personId };
  };

  it("apaga pessoa + user no IdP e publica personDeleted (superadmin)", async () => {
    const { app, people, publisher, idp, personId } = await withLogin();
    publisher.published.length = 0;

    const res = await app.handle(new Request(url(`/people/${personId}`), { method: "DELETE" }));

    expect(res.status).toBe(204);
    expect(idp.calls.deleteUser).toEqual(["id-33"]);
    expect(await people.findById(personId)).toBeNull();
    expect(publisher.published.map((p) => p.subject)).toContain("people.person.deleted");
  });

  it("apaga pessoa sem login sem tocar o IdP", async () => {
    const ctx = setup({ guard: superadmin() });
    const personId = await createPerson(ctx.app, {
      fullName: "Sem Login",
      birthDate: "2000-01-01",
    });

    const res = await ctx.app.handle(new Request(url(`/people/${personId}`), { method: "DELETE" }));

    expect(res.status).toBe(204);
    expect(ctx.idp.calls.deleteUser.length).toBe(0);
    expect(await ctx.people.findById(personId)).toBeNull();
  });

  it("retorna 403 quando o caller nao e superadmin", async () => {
    const { app } = setup(); // guard default = admin
    const personId = await createPerson(app, { fullName: "X", birthDate: "2000-01-01" });

    const res = await app.handle(new Request(url(`/people/${personId}`), { method: "DELETE" }));
    expect(res.status).toBe(403);
    const body = (await parseJson(res)) as unknown as { error: { code: string } };
    expect(body.error.code).toBe("PEO-010");
  });

  it("retorna 400 quando personId nao e UUID (superadmin)", async () => {
    const app = setup({ guard: superadmin() }).app;
    const res = await app.handle(new Request(url("/people/not-a-uuid"), { method: "DELETE" }));
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando a pessoa nao existe (superadmin)", async () => {
    const app = setup({ guard: superadmin() }).app;
    const res = await app.handle(
      new Request(url("/people/00000000-0000-0000-0000-000000000000"), { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
  });

  it("retorna 502 e nao apaga no DB quando o delete no IdP falha", async () => {
    const { app, people, personId } = await withLogin({
      deleteUserFails: { code: 500, message: "idp down" },
    });

    const res = await app.handle(new Request(url(`/people/${personId}`), { method: "DELETE" }));

    expect(res.status).toBe(502);
    const body = (await parseJson(res)) as unknown as { error: { code: string; message: string } };
    expect(body.error.code).toBe("IDP-005");
    expect(body.error.message).not.toContain("idp down");
    expect(await people.findById(personId)).not.toBeNull(); // DB intocado
  });
});
