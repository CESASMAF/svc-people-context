import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createPeopleRoutes } from "../../src/routes/people.ts";
import {
  createFakePersonRepository,
  createFakeRoleRepository,
} from "../routes/fake-repositories.ts";
import { createRejectingAuthGuard } from "../routes/fake-auth.ts";
import { createFakePublisher } from "../routes/fake-publisher.ts";
import { createNoopIdpClient } from "../../src/idp/index.ts";
import { createAuthGuard } from "../../src/middleware/auth.ts";
import type { JwtVerifier } from "../../src/middleware/jwt.ts";
import type { CerbosClient } from "../../src/middleware/cerbos.ts";
import { PeopleAction, PolicyResource } from "../../src/middleware/policy-actions.ts";

const setup = () => {
  const people = createFakePersonRepository();
  const roles = createFakeRoleRepository();
  const guard = createRejectingAuthGuard();
  const publisher = createFakePublisher();
  const idp = createNoopIdpClient();
  const app = new Elysia().use(createPeopleRoutes({ people, roles, guard, publisher, idp }));
  return { app };
};

describe("Auth guard — all endpoints require authentication", () => {
  it("returns 401 on POST /people when auth fails", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: "Ana Costa", birthDate: "1990-05-15" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 on PUT /people/:id when auth fails", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/00000000-0000-0000-0000-000000000000", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: "Ana", birthDate: "1990-05-15" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 on GET /people when auth fails", async () => {
    const { app } = setup();
    const res = await app.handle(new Request("http://localhost/api/v1/people"));
    expect(res.status).toBe(401);
  });

  it("returns 401 on GET /people/:id when auth fails", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/00000000-0000-0000-0000-000000000000"),
    );
    expect(res.status).toBe(401);
  });
});

describe("Auth guard — composite role matching", () => {
  const fakeVerifier =
    (roles: string[]): JwtVerifier =>
    async () => ({ sub: "test-user", roles });

  it("matches simple role exactly", async () => {
    const guard = createAuthGuard(fakeVerifier(["admin"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["admin"]);
    expect(result.kind).toBe("ok");
  });

  it("matches composite role 'social-care:admin' when guard requires 'admin'", async () => {
    const guard = createAuthGuard(fakeVerifier(["social-care:admin"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["admin"]);
    expect(result.kind).toBe("ok");
  });

  it("matches composite role 'social-care:worker' when guard requires 'worker'", async () => {
    const guard = createAuthGuard(fakeVerifier(["social-care:worker"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["worker"]);
    expect(result.kind).toBe("ok");
  });

  it("rejects when no role matches", async () => {
    const guard = createAuthGuard(fakeVerifier(["social-care:viewer"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["admin"]);
    expect(result.kind).toBe("forbidden");
  });

  it("matches when one of multiple required roles is present", async () => {
    const guard = createAuthGuard(fakeVerifier(["queue-manager:owner"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, [
      "worker",
      "owner",
      "admin",
    ]);
    expect(result.kind).toBe("ok");
  });

  it("matches mixed simple and composite roles", async () => {
    const guard = createAuthGuard(fakeVerifier(["admin", "social-care:worker"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["worker"]);
    expect(result.kind).toBe("ok");
  });

  it("superadmin bypasses all role checks", async () => {
    const guard = createAuthGuard(fakeVerifier(["superadmin"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["admin"]);
    expect(result.kind).toBe("ok");
  });

  it("superadmin bypasses even with unrelated required roles", async () => {
    const guard = createAuthGuard(fakeVerifier(["superadmin"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, [
      "worker",
      "owner",
    ]);
    expect(result.kind).toBe("ok");
  });
});

describe("Auth guard — Cerbos (PDP) defense-in-depth", () => {
  const fakeVerifier =
    (roles: string[]): JwtVerifier =>
    async () => ({ sub: "actor-1", roles });

  // Cerbos que sempre devolve `decision` e registra a última chamada.
  const fakeCerbos = (decision: boolean | null): { client: CerbosClient; calls: unknown[] } => {
    const calls: unknown[] = [];
    return {
      calls,
      client: {
        check: async (input) => {
          calls.push(input);
          return decision;
        },
      },
    };
  };

  // Vocabulário REAL da policy (`people.yaml`) — ver tests/middleware/cerbos-contrato.test.ts.
  const AUTHZ = { resource: PolicyResource.people, action: PeopleAction.create } as const;
  const headers = { authorization: "Bearer fake", "x-actor-id": "actor" };

  it("DENY explícito do Cerbos → forbidden (mesmo com role local válida)", async () => {
    const cerbos = fakeCerbos(false);
    const guard = createAuthGuard(fakeVerifier(["people-context:admin"]), cerbos.client);
    const result = await guard(headers, ["admin"], true, AUTHZ);
    expect(result.kind).toBe("forbidden");
    // passou o principal (sub) e os grupos como roles p/ o decision log
    expect(cerbos.calls).toHaveLength(1);
    expect(cerbos.calls[0]).toMatchObject({
      resource: "people",
      action: "create",
      principalId: "actor-1",
      roles: ["people-context:admin"],
    });
  });

  it("ALLOW do Cerbos → ok", async () => {
    const cerbos = fakeCerbos(true);
    const guard = createAuthGuard(fakeVerifier(["people-context:admin"]), cerbos.client);
    const result = await guard(headers, ["admin"], true, AUTHZ);
    expect(result.kind).toBe("ok");
  });

  it("indeterminado (Cerbos off/erro → null) defere ao guard local (ok)", async () => {
    const cerbos = fakeCerbos(null);
    const guard = createAuthGuard(fakeVerifier(["people-context:admin"]), cerbos.client);
    const result = await guard(headers, ["admin"], true, AUTHZ);
    expect(result.kind).toBe("ok");
  });

  it("sem authz → Cerbos NÃO é consultado (comportamento inalterado)", async () => {
    const cerbos = fakeCerbos(false); // negaria se consultado
    const guard = createAuthGuard(fakeVerifier(["people-context:admin"]), cerbos.client);
    const result = await guard(headers, ["admin"]); // sem authz
    expect(result.kind).toBe("ok");
    expect(cerbos.calls).toHaveLength(0);
  });

  it("role local reprova ANTES do Cerbos → forbidden sem consultar o PDP", async () => {
    const cerbos = fakeCerbos(true); // permitiria se consultado
    const guard = createAuthGuard(fakeVerifier(["people-context:viewer"]), cerbos.client);
    const result = await guard(headers, ["admin"], true, AUTHZ);
    expect(result.kind).toBe("forbidden");
    expect(cerbos.calls).toHaveLength(0);
  });
});

// O bypass de superadmin precisa casar com o derived role do Cerbos (`_common_roles.yaml`):
//   P.roles.exists(r, r == "superadmin" || r.endsWith(":superadmin"))
// A igualdade exata que estava aqui trancava `<system>:superadmin` FORA das rotas admin — com
// um AUTH-002 dizendo que faltava o papel `admin` — enquanto o PDP concederia. Duas metades do
// mesmo defense-in-depth discordando sobre quem e superadmin.
describe("Bypass de superadmin — mesma definicao do Cerbos", () => {
  const fakeVerifier =
    (roles: string[]): JwtVerifier =>
    async () => ({ sub: "actor-1", roles });
  const headers = { authorization: "Bearer fake", "x-actor-id": "actor" };

  it("aceita `superadmin` bare", async () => {
    const guard = createAuthGuard(fakeVerifier(["superadmin"]));
    expect((await guard(headers, ["admin"])).kind).toBe("ok");
  });

  it("aceita `<system>:superadmin` (forma prevista em _common_roles.yaml)", async () => {
    for (const r of ["people-context:superadmin", "social-care:superadmin"]) {
      const guard = createAuthGuard(fakeVerifier([r]));
      expect((await guard(headers, ["admin"])).kind).toBe("ok");
    }
  });

  it("NAO aceita quem so parece superadmin", async () => {
    for (const r of ["superadminx", "naosuperadmin", "admin:super"]) {
      const guard = createAuthGuard(fakeVerifier([r]));
      expect((await guard(headers, ["admin"])).kind).toBe("forbidden");
    }
  });
});
