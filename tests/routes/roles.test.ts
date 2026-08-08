import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createPeopleRoutes } from "../../src/routes/people.ts";
import { createRolesRoutes } from "../../src/routes/roles.ts";
import { createFakePersonRepository, createFakeRoleRepository } from "./fake-repositories.ts";
import {
  createDeferringAuthzCheck,
  createFakeAuthGuard,
  createFakeAuthGuardWithRoles,
} from "./fake-auth.ts";
import { createFakePublisher } from "./fake-publisher.ts";
import { createNoopIdpClient } from "../../src/idp/index.ts";
import { createFakeIdpClient } from "./fake-idp.ts";
import { parseJson, dataAs, dataAsArray, type IdData, type RoleData } from "./test-types.ts";

const setup = (guardRoles?: string[], guardSub?: string) => {
  const people = createFakePersonRepository();
  const roles = createFakeRoleRepository();
  const guard = guardRoles
    ? createFakeAuthGuardWithRoles(guardRoles, guardSub)
    : createFakeAuthGuardWithRoles(["superadmin"]);
  const publisher = createFakePublisher();
  const idp = createNoopIdpClient();
  // People routes use a permissive guard so createPerson helper works
  const peopleGuard = createFakeAuthGuard();
  const app = new Elysia()
    .use(createPeopleRoutes({ people, roles, guard: peopleGuard, publisher, idp }))
    .use(
      createRolesRoutes({
        people,
        roles,
        guard,
        authz: createDeferringAuthzCheck(),
        publisher,
        idp,
      }),
    );
  return { app, people, roles, publisher };
};

const setupWithFakeIdp = (guardRoles: string[], guardSub = "test-user") => {
  const people = createFakePersonRepository();
  const roles = createFakeRoleRepository();
  const guard = createFakeAuthGuardWithRoles(guardRoles, guardSub);
  const publisher = createFakePublisher();
  const idp = createFakeIdpClient();
  const peopleGuard = createFakeAuthGuard();
  const app = new Elysia()
    .use(createPeopleRoutes({ people, roles, guard: peopleGuard, publisher, idp }))
    .use(
      createRolesRoutes({
        people,
        roles,
        guard,
        authz: createDeferringAuthzCheck(),
        publisher,
        idp,
      }),
    );
  return { app, people, roles, publisher, idp };
};

const json = (body: unknown) => ({
  method: "POST" as const,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const createPerson = async (app: ReturnType<typeof setup>["app"]) => {
  const res = await app.handle(
    new Request(
      "http://localhost/api/v1/people",
      json({ fullName: "Ana Costa", birthDate: "1990-05-15" }),
    ),
  );
  return dataAs<IdData>(await parseJson(res)).id;
};

describe("POST /api/v1/people/:personId/roles — UUID validation", () => {
  it("returns 400 for invalid personId UUID", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request(
        "http://localhost/api/v1/people/not-a-uuid/roles",
        json({ system: "social-care", role: "patient" }),
      ),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/people/:personId/roles — UUID validation", () => {
  it("returns 400 for invalid personId UUID", async () => {
    const { app } = setup();
    const res = await app.handle(new Request("http://localhost/api/v1/people/not-a-uuid/roles"));
    expect(res.status).toBe(400);
  });
});

describe("PUT deactivate/reactivate — UUID validation", () => {
  it("returns 400 for invalid UUIDs on deactivate", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/not-a-uuid/roles/also-bad/deactivate", {
        method: "PUT",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid UUIDs on reactivate", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/not-a-uuid/roles/also-bad/reactivate", {
        method: "PUT",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/people/:personId/roles", () => {
  it("assigns a role and returns 201 with roleAssigned event", async () => {
    const { app, publisher } = setup();
    const personId = await createPerson(app);
    publisher.published.length = 0; // reset after person creation

    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "patient" }),
      ),
    );
    expect(res.status).toBe(201);
    const body = await parseJson(res);
    expect(dataAs<IdData>(body).id).toBeDefined();

    expect(publisher.published.length).toBe(1);
    expect(publisher.published[0]!.subject).toBe("people.role.assigned");
    const eventData = (
      publisher.published[0]!.payload as { data: { system: string; role: string } }
    ).data;
    expect(eventData.system).toBe("social-care");
    expect(eventData.role).toBe("patient");
  });

  it("returns 204 when role already exists and is active (idempotent, no event)", async () => {
    const { app, publisher } = setup();
    const personId = await createPerson(app);

    await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "patient" }),
      ),
    );
    const countBefore = publisher.published.length;

    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "patient" }),
      ),
    );
    expect(res.status).toBe(204);
    // No new event on idempotent call
    expect(publisher.published.length).toBe(countBefore);
  });

  it("returns 404 for unknown person", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request(
        "http://localhost/api/v1/people/00000000-0000-0000-0000-000000000000/roles",
        json({ system: "social-care", role: "patient" }),
      ),
    );
    expect(res.status).toBe(404);
  });

  it("returns 422 for empty system (schema validation)", async () => {
    const { app } = setup();
    const personId = await createPerson(app);
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "", role: "patient" }),
      ),
    );
    expect(res.status).toBe(422);
  });
});

describe("GET /api/v1/people/:personId/roles", () => {
  it("returns roles for a person", async () => {
    const { app } = setup();
    const personId = await createPerson(app);

    await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "patient" }),
      ),
    );
    await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "queue-manager", role: "professional" }),
      ),
    );

    const res = await app.handle(new Request(`http://localhost/api/v1/people/${personId}/roles`));
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(dataAsArray<RoleData>(body).length).toBe(2);
  });

  it("returns 404 for unknown person", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/00000000-0000-0000-0000-000000000000/roles"),
    );
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/v1/people/:personId/roles/:roleId/deactivate", () => {
  it("deactivates a role, returns 204, and publishes roleDeactivated event", async () => {
    const { app, publisher } = setup();
    const personId = await createPerson(app);

    const assignRes = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "patient" }),
      ),
    );
    const roleId = dataAs<IdData>(await parseJson(assignRes)).id;
    publisher.published.length = 0;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/deactivate`, {
        method: "PUT",
      }),
    );
    expect(res.status).toBe(204);

    expect(publisher.published.length).toBe(1);
    expect(publisher.published[0]!.subject).toBe("people.role.deactivated");
    const eventData = (
      publisher.published[0]!.payload as { data: { system: string; role: string } }
    ).data;
    expect(eventData.system).toBe("social-care");
    expect(eventData.role).toBe("patient");
  });

  it("returns 404 for unknown role", async () => {
    const { app } = setup();
    const personId = await createPerson(app);
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles/00000000-0000-0000-0000-000000000000/deactivate`,
        { method: "PUT" },
      ),
    );
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/v1/people/:personId/roles/:roleId/reactivate", () => {
  it("reactivates a deactivated role and publishes roleReactivated event", async () => {
    const { app, publisher } = setup();
    const personId = await createPerson(app);

    const assignRes = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "patient" }),
      ),
    );
    const roleId = dataAs<IdData>(await parseJson(assignRes)).id;

    await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/deactivate`, {
        method: "PUT",
      }),
    );
    publisher.published.length = 0;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/reactivate`, {
        method: "PUT",
      }),
    );
    expect(res.status).toBe(204);

    expect(publisher.published.length).toBe(1);
    expect(publisher.published[0]!.subject).toBe("people.role.reactivated");
    const eventData = (
      publisher.published[0]!.payload as { data: { system: string; role: string } }
    ).data;
    expect(eventData.system).toBe("social-care");
    expect(eventData.role).toBe("patient");
  });

  it("returns 404 when role is already active", async () => {
    const { app } = setup();
    const personId = await createPerson(app);

    const assignRes = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "patient" }),
      ),
    );
    const roleId = dataAs<IdData>(await parseJson(assignRes)).id;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/reactivate`, {
        method: "PUT",
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/roles", () => {
  it("queries roles by system", async () => {
    const { app } = setup();
    const personId = await createPerson(app);
    await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "patient" }),
      ),
    );

    const res = await app.handle(new Request("http://localhost/api/v1/roles?system=social-care"));
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    const results = dataAsArray<{ role: RoleData }>(body);
    expect(results.length).toBe(1);
    expect(results[0]!.role.system).toBe("social-care");
  });

  it("returns 400 without system parameter", async () => {
    const { app } = setup();
    const res = await app.handle(new Request("http://localhost/api/v1/roles"));
    expect(res.status).toBe(400);
  });
});

// ─── RBAC security tests ────────────────────────────────────────

describe("Role assignment — system-scoped authorization", () => {
  it("social-care:admin can assign roles in social-care", async () => {
    const { app } = setup(["social-care:admin"]);
    const personId = await createPerson(app);
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "patient" }),
      ),
    );
    expect(res.status).toBe(201);
  });

  it("social-care:admin cannot assign roles in queue-manager", async () => {
    const { app } = setup(["social-care:admin"]);
    const personId = await createPerson(app);
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "queue-manager", role: "worker" }),
      ),
    );
    expect(res.status).toBe(403);
    const body = await parseJson(res);
    expect((body as unknown as { error: { code: string } }).error.code).toBe("ROL-007");
  });

  it("superadmin can assign roles in any system", async () => {
    const { app } = setup(["superadmin"]);
    const personId = await createPerson(app);
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "queue-manager", role: "worker" }),
      ),
    );
    expect(res.status).toBe(201);
  });

  it("only superadmin can assign superadmin role", async () => {
    const { app } = setup(["social-care:admin"]);
    const personId = await createPerson(app);
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "global", role: "superadmin" }),
      ),
    );
    expect(res.status).toBe(403);
    const body = await parseJson(res);
    expect((body as unknown as { error: { code: string } }).error.code).toBe("ROL-006");
  });

  it("superadmin can assign superadmin role", async () => {
    const { app } = setup(["superadmin"]);
    const personId = await createPerson(app);
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "global", role: "superadmin" }),
      ),
    );
    expect(res.status).toBe(201);
  });
});

describe("Role assignment — self-assignment prevention", () => {
  it("admin cannot assign roles to themselves", async () => {
    const { app, people } = setup(["social-care:admin"], "idp-user-123");
    // Create person and link idpUserId to match the caller's sub
    const personId = await createPerson(app);
    await people.setIdpUserId(personId, "idp-user-123", "test@test.com");

    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "owner" }),
      ),
    );
    expect(res.status).toBe(403);
    const body = await parseJson(res);
    expect((body as unknown as { error: { code: string } }).error.code).toBe("ROL-008");
  });

  it("superadmin can assign roles to themselves", async () => {
    const { app, people } = setup(["superadmin"], "superadmin-user");
    const personId = await createPerson(app);
    await people.setIdpUserId(personId, "superadmin-user", "super@test.com");

    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "admin" }),
      ),
    );
    expect(res.status).toBe(201);
  });
});

// ─── Domain validation (ROL-001) ────────────────────────────────

describe("POST /api/v1/people/:personId/roles — domain validation", () => {
  it("retorna 400 com ROL-001 quando system é apenas whitespace", async () => {
    const { app } = setup();
    const personId = await createPerson(app);
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "   ", role: "patient" }),
      ),
    );
    expect(res.status).toBe(400);
    const body = (await parseJson(res)) as unknown as { error: { code: string } };
    expect(body.error.code).toBe("ROL-001");
  });

  it("retorna 400 com ROL-001 quando role é apenas whitespace", async () => {
    const { app } = setup();
    const personId = await createPerson(app);
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "social-care", role: "   " }),
      ),
    );
    expect(res.status).toBe(400);
    const body = (await parseJson(res)) as unknown as { error: { code: string } };
    expect(body.error.code).toBe("ROL-001");
  });
});

// ─── deactivate/reactivate authz + sync IdP ─────────────────────

describe("PUT roles/:roleId/deactivate — authz e IdP sync", () => {
  const assignRole = async (
    app: { handle: (req: Request) => Promise<Response> },
    personId: string,
    system: string,
    role: string,
  ): Promise<string> => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles`, json({ system, role })),
    );
    return dataAs<IdData>(await parseJson(res)).id;
  };

  it("retorna 403 ROL-007 quando admin tenta desativar role fora dos seus sistemas", async () => {
    // assign como superadmin pra criar a role
    const { app: appSuper, roles } = setup(["superadmin"]);
    const personId = await createPerson(appSuper);
    const roleId = await assignRole(appSuper, personId, "queue-manager", "worker");

    // tenta desativar com admin de social-care
    const guard = createFakeAuthGuardWithRoles(["social-care:admin"]);
    const peopleGuard = createFakeAuthGuard();
    const publisher = createFakePublisher();
    const idp = createNoopIdpClient();
    const people = createFakePersonRepository();
    const app = new Elysia()
      .use(createPeopleRoutes({ people, roles, guard: peopleGuard, publisher, idp }))
      .use(
        createRolesRoutes({
          people,
          roles,
          guard,
          authz: createDeferringAuthzCheck(),
          publisher,
          idp,
        }),
      );

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/deactivate`, {
        method: "PUT",
      }),
    );
    expect(res.status).toBe(403);
    const body = (await parseJson(res)) as unknown as { error: { code: string } };
    expect(body.error.code).toBe("ROL-007");
  });

  it("sincroniza remocao no IdP quando pessoa tem idpUserId", async () => {
    const { app, people, idp } = setupWithFakeIdp(["superadmin"]);
    const personId = await createPerson(app);
    await people.setIdpUserId(personId, "id-200", "x@y.com");
    const roleId = await assignRole(app, personId, "social-care", "worker");
    idp.calls.removeUserFromGroup.length = 0;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/deactivate`, {
        method: "PUT",
      }),
    );
    expect(res.status).toBe(204);
    expect(idp.calls.removeUserFromGroup.length).toBe(1);
    expect(idp.calls.removeUserFromGroup[0]!.id).toBe("id-200");
  });

  it("nao sincroniza IdP quando pessoa nao tem idpUserId", async () => {
    const { app, idp } = setupWithFakeIdp(["superadmin"]);
    const personId = await createPerson(app);
    const roleId = await assignRole(app, personId, "social-care", "worker");
    idp.calls.removeUserFromGroup.length = 0;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/deactivate`, {
        method: "PUT",
      }),
    );
    expect(res.status).toBe(204);
    expect(idp.calls.removeUserFromGroup.length).toBe(0);
  });
});

describe("PUT roles/:roleId/reactivate — authz e IdP sync", () => {
  const assignRole = async (
    app: { handle: (req: Request) => Promise<Response> },
    personId: string,
    system: string,
    role: string,
  ): Promise<string> => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles`, json({ system, role })),
    );
    return dataAs<IdData>(await parseJson(res)).id;
  };

  it("retorna 403 ROL-007 quando admin tenta reativar role fora dos seus sistemas", async () => {
    const { app: appSuper, roles } = setup(["superadmin"]);
    const personId = await createPerson(appSuper);
    const roleId = await assignRole(appSuper, personId, "queue-manager", "worker");
    await appSuper.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/deactivate`, {
        method: "PUT",
      }),
    );

    const guard = createFakeAuthGuardWithRoles(["social-care:admin"]);
    const peopleGuard = createFakeAuthGuard();
    const publisher = createFakePublisher();
    const idp = createNoopIdpClient();
    const people = createFakePersonRepository();
    const app = new Elysia()
      .use(createPeopleRoutes({ people, roles, guard: peopleGuard, publisher, idp }))
      .use(
        createRolesRoutes({
          people,
          roles,
          guard,
          authz: createDeferringAuthzCheck(),
          publisher,
          idp,
        }),
      );

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/reactivate`, {
        method: "PUT",
      }),
    );
    expect(res.status).toBe(403);
    const body = (await parseJson(res)) as unknown as { error: { code: string } };
    expect(body.error.code).toBe("ROL-007");
  });

  it("sincroniza re-atribuicao no IdP quando pessoa tem idpUserId", async () => {
    const { app, people, idp } = setupWithFakeIdp(["superadmin"]);
    const personId = await createPerson(app);
    await people.setIdpUserId(personId, "id-300", "x@y.com");
    const roleId = await assignRole(app, personId, "social-care", "worker");
    await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/deactivate`, {
        method: "PUT",
      }),
    );
    idp.calls.addUserToGroup.length = 0;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/reactivate`, {
        method: "PUT",
      }),
    );
    expect(res.status).toBe(204);
    expect(idp.calls.addUserToGroup.length).toBe(1);
    expect(idp.calls.addUserToGroup[0]!.id).toBe("id-300");
  });
});
