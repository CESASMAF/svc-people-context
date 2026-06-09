import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createPeopleRoutes } from "../../src/routes/people.ts";
import { createFakePersonRepository } from "./fake-repositories.ts";
import { createFakeAuthGuard } from "./fake-auth.ts";
import { createFakePublisher } from "./fake-publisher.ts";
import { createFakeAuthentikClient, type FakeAuthentikOverrides } from "./fake-authentik.ts";
import { parseJson, dataAs, type IdData } from "./test-types.ts";

const setup = (idpOverrides: FakeAuthentikOverrides = {}) => {
  const people = createFakePersonRepository();
  const guard = createFakeAuthGuard();
  const publisher = createFakePublisher();
  const idp = createFakeAuthentikClient(idpOverrides);
  const app = new Elysia().use(createPeopleRoutes({ people, guard, publisher, idp }));
  return { app, people, publisher, idp };
};

const json = (body: unknown) => ({
  method: "POST" as const,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const createPerson = async (
  app: ReturnType<typeof setup>["app"],
  body: Record<string, unknown> = { fullName: "Ana Costa", birthDate: "1990-05-15" },
): Promise<string> => {
  const res = await app.handle(new Request("http://localhost/api/v1/people", json(body)));
  return dataAs<IdData>(await parseJson(res)).id;
};

// ─── POST /people com createLogin → provisionamento IdP ─────────

describe("POST /api/v1/people — createLogin path", () => {
  it("provisiona user no IdP e persiste uid + pk quando createLogin=true", async () => {
    const { app, people, publisher, idp } = setup({
      createUserPk: 77,
      createUserUid: "uid-77",
    });

    const res = await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({
          fullName: "Joao Silva",
          birthDate: "1990-05-15",
          email: "joao@example.com",
          createLogin: true,
          initialPassword: "Secret123!",
        }),
      ),
    );

    expect(res.status).toBe(201);
    const { id } = dataAs<IdData>(await parseJson(res));

    expect(idp.calls.createUser.length).toBe(1);
    expect(idp.calls.setPassword[0]?.pk).toBe(77);

    const stored = await people.findById(id);
    expect(stored?.idpUserId).toBe("uid-77");
    expect(stored?.idpUserPk).toBe(77);

    const events = publisher.published.map((p) => p.subject);
    expect(events).toContain("people.user.provisioned");
  });

  it("retorna 207 com warning quando IdP createUser falha (erro nao-retentavel)", async () => {
    const { app, idp } = setup({
      createUserFails: { code: 500, message: "idp error" },
    });

    const res = await app.handle(
      new Request(
        "http://localhost/api/v1/people",
        json({
          fullName: "Joao Silva",
          birthDate: "1990-05-15",
          email: "joao@example.com",
          createLogin: true,
        }),
      ),
    );

    expect(res.status).toBe(207);
    const body = (await parseJson(res)) as { warnings?: { code: string }[] };
    expect(body.warnings?.[0]?.code).toBe("IDP-001");
    // 500 nao e retentavel — uma unica tentativa de createUser.
    expect(idp.calls.createUser.length).toBe(1);
  });
});

// ─── PUT /people/:id/deactivate ─────────────────────────────────

describe("PUT /api/v1/people/:personId/deactivate", () => {
  const provision = async (overrides: FakeAuthentikOverrides = {}) => {
    const ctx = setup({ createUserPk: 50, createUserUid: "uid-50", ...overrides });
    const personId = await createPerson(ctx.app, {
      fullName: "Ana Costa",
      birthDate: "1990-05-15",
      email: "ana@example.com",
      createLogin: true,
    });
    return { ...ctx, personId };
  };

  it("desativa pessoa + IdP, retorna 204 e publica userDeactivated", async () => {
    const { app, publisher, idp, personId, people } = await provision();
    publisher.published.length = 0;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/deactivate`, { method: "PUT" }),
    );

    expect(res.status).toBe(204);
    expect(idp.calls.deactivateUser).toEqual([50]);
    const stored = await people.findById(personId);
    expect(stored?.active).toBe(false);
    expect(publisher.published.map((p) => p.subject)).toContain("people.user.deactivated");
  });

  it("retorna 400 quando personId nao e UUID", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/not-a-uuid/deactivate", { method: "PUT" }),
    );
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando pessoa nao existe", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request(
        "http://localhost/api/v1/people/00000000-0000-0000-0000-000000000000/deactivate",
        { method: "PUT" },
      ),
    );
    expect(res.status).toBe(404);
  });

  it("retorna 409 quando pessoa ja esta inativa", async () => {
    const { app, personId } = await provision();
    await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/deactivate`, { method: "PUT" }),
    );

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/deactivate`, { method: "PUT" }),
    );
    expect(res.status).toBe(409);
  });

  it("retorna 502 e nao desativa no DB quando IdP falha", async () => {
    const { app, idp, personId, people } = await provision({
      deactivateFails: { code: 500, message: "idp down" },
    });

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/deactivate`, { method: "PUT" }),
    );

    expect(res.status).toBe(502);
    const body = (await parseJson(res)) as unknown as { error: { code: string; message: string } };
    expect(body.error.code).toBe("IDP-002");
    // AppSec HIGH-7: nao vazar message do Authentik
    expect(body.error.message).not.toContain("idp down");
    expect(idp.calls.deactivateUser).toEqual([50]);

    const stored = await people.findById(personId);
    expect(stored?.active).toBe(true); // DB intocado
  });

  it("desativa apenas no DB quando pessoa nao tem login IdP", async () => {
    const { app, idp } = setup();
    const personId = await createPerson(app); // sem createLogin
    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/deactivate`, { method: "PUT" }),
    );
    expect(res.status).toBe(204);
    expect(idp.calls.deactivateUser.length).toBe(0);
  });
});

// ─── PUT /people/:id/reactivate ─────────────────────────────────

describe("PUT /api/v1/people/:personId/reactivate", () => {
  const setupDeactivated = async (overrides: FakeAuthentikOverrides = {}) => {
    const ctx = setup({ createUserPk: 60, createUserUid: "uid-60", ...overrides });
    const personId = await createPerson(ctx.app, {
      fullName: "Ana Costa",
      birthDate: "1990-05-15",
      email: "ana@example.com",
      createLogin: true,
    });
    await ctx.app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/deactivate`, { method: "PUT" }),
    );
    return { ...ctx, personId };
  };

  it("reativa pessoa + IdP, retorna 204 e publica userReactivated", async () => {
    const { app, publisher, idp, personId, people } = await setupDeactivated();
    publisher.published.length = 0;
    idp.calls.reactivateUser.length = 0;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/reactivate`, { method: "PUT" }),
    );

    expect(res.status).toBe(204);
    expect(idp.calls.reactivateUser).toEqual([60]);
    const stored = await people.findById(personId);
    expect(stored?.active).toBe(true);
    expect(publisher.published.map((p) => p.subject)).toContain("people.user.reactivated");
  });

  it("retorna 400 quando personId nao e UUID", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/not-a-uuid/reactivate", { method: "PUT" }),
    );
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando pessoa nao existe", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request(
        "http://localhost/api/v1/people/00000000-0000-0000-0000-000000000000/reactivate",
        { method: "PUT" },
      ),
    );
    expect(res.status).toBe(404);
  });

  it("retorna 409 quando pessoa ja esta ativa", async () => {
    const { app } = setup();
    const personId = await createPerson(app);
    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/reactivate`, { method: "PUT" }),
    );
    expect(res.status).toBe(409);
  });

  it("retorna 502 quando IdP falha", async () => {
    const { app, personId } = await setupDeactivated({
      reactivateFails: { code: 500, message: "idp down" },
    });

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/reactivate`, { method: "PUT" }),
    );

    expect(res.status).toBe(502);
    const body = (await parseJson(res)) as unknown as { error: { code: string } };
    expect(body.error.code).toBe("IDP-003");
  });

  it("reativa apenas no DB quando pessoa nao tem login IdP", async () => {
    const { app, people, idp } = setup();
    const personId = await createPerson(app);
    await people.deactivate(personId);

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/reactivate`, { method: "PUT" }),
    );
    expect(res.status).toBe(204);
    expect(idp.calls.reactivateUser.length).toBe(0);
  });
});

// ─── POST /people/:id/request-password-reset ────────────────────

describe("POST /api/v1/people/:personId/request-password-reset", () => {
  const provision = async (overrides: FakeAuthentikOverrides = {}) => {
    const ctx = setup({ createUserPk: 70, createUserUid: "uid-70", ...overrides });
    const personId = await createPerson(ctx.app, {
      fullName: "Ana Costa",
      birthDate: "1990-05-15",
      email: "ana@example.com",
      createLogin: true,
    });
    return { ...ctx, personId };
  };

  it("publica passwordResetRequested com link e retorna 202 (link NAO no body)", async () => {
    const { app, publisher, idp, personId } = await provision({
      recoveryLink: "https://auth.acdgbrasil.com.br/recovery?token=abc",
    });
    publisher.published.length = 0;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/request-password-reset`, {
        method: "POST",
      }),
    );

    expect(res.status).toBe(202);
    const body = await parseJson(res);
    expect((body as unknown as { data?: unknown }).data).toBeUndefined();
    expect(idp.calls.requestPasswordReset).toEqual([70]);

    const event = publisher.published.find(
      (p) => p.subject === "people.user.password_reset_requested",
    );
    expect(event).toBeDefined();
    const eventData = (event!.payload as { data: { recoveryLink: string } }).data;
    expect(eventData.recoveryLink).toContain("recovery?token=abc");
  });

  it("retorna 400 quando personId nao e UUID", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/not-a-uuid/request-password-reset", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando pessoa nao existe", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request(
        "http://localhost/api/v1/people/00000000-0000-0000-0000-000000000000/request-password-reset",
        { method: "POST" },
      ),
    );
    expect(res.status).toBe(404);
  });

  it("retorna 422 quando pessoa nao tem login IdP", async () => {
    const { app } = setup();
    const personId = await createPerson(app);
    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/request-password-reset`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(422);
    const body = (await parseJson(res)) as unknown as { error: { code: string } };
    expect(body.error.code).toBe("PEO-007");
  });

  it("retorna 502 quando IdP falha (e nao publica evento)", async () => {
    const { app, publisher, personId } = await provision({
      requestPasswordResetFails: { code: 500, message: "idp down" },
    });
    publisher.published.length = 0;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/request-password-reset`, {
        method: "POST",
      }),
    );

    expect(res.status).toBe(502);
    const body = (await parseJson(res)) as unknown as { error: { code: string; message: string } };
    expect(body.error.code).toBe("IDP-004");
    expect(body.error.message).not.toContain("idp down");
    expect(
      publisher.published.find((p) => p.subject === "people.user.password_reset_requested"),
    ).toBeUndefined();
  });
});
