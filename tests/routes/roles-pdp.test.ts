// Rotas de papel × PDP: o que vai no check do Cerbos.
//
// `role.yaml` NAO decide por role do principal — decide por ATRIBUTO do recurso:
//
//   assign  ⟸  P.roles.exists(r, r == R.attr.system + ":admin")
//          ∧  R.attr.targetRole != "superadmin"
//          ∧  P.id != R.attr.targetUserId
//
// Sem `attr` no payload a condicao nao tem como ser avaliada e o Cerbos responde DENY —
// verificado contra o PDP de producao em 2026-08-08. Por isso estas rotas consultam o PDP
// numa 2a fase, depois de conhecer `system`, `targetRole` e o alvo.
//
// Estes testes fixam o CONTEUDO desse check. O contrato de NOMES esta em
// `tests/middleware/cerbos-contrato.test.ts`.
import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createPeopleRoutes } from "../../src/routes/people.ts";
import { createRolesRoutes } from "../../src/routes/roles.ts";
import { createFakePersonRepository, createFakeRoleRepository } from "./fake-repositories.ts";
import {
  createDenyingAuthzCheck,
  createFakeAuthGuard,
  createFakeAuthGuardWithRoles,
  createRecordingAuthzCheck,
} from "./fake-auth.ts";
import { createFakePublisher } from "./fake-publisher.ts";
import { createNoopIdpClient } from "../../src/idp/index.ts";
import type { AuthzCheck } from "../../src/middleware/auth.ts";
import { parseJson, dataAs, type IdData } from "./test-types.ts";

const json = (body: unknown) => ({
  method: "POST" as const,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const setup = (
  authz: ReturnType<typeof createRecordingAuthzCheck>["check"],
  sub = "idp-caller",
) => {
  const people = createFakePersonRepository();
  const roles = createFakeRoleRepository();
  const publisher = createFakePublisher();
  const idp = createNoopIdpClient();
  const app = new Elysia()
    .use(createPeopleRoutes({ people, roles, guard: createFakeAuthGuard(), publisher, idp }))
    .use(
      createRolesRoutes({
        people,
        roles,
        guard: createFakeAuthGuardWithRoles(["people-context:admin"], sub),
        authz,
        publisher,
        idp,
      }),
    );
  return { app, people, roles };
};

const createPerson = async (app: ReturnType<typeof setup>["app"]) => {
  const res = await app.handle(
    new Request(
      "http://localhost/api/v1/people",
      json({ fullName: "Ana Costa", birthDate: "1990-05-15" }),
    ),
  );
  return dataAs<IdData>(await parseJson(res)).id;
};

describe("POST /people/:id/roles — atributos enviados ao PDP", () => {
  it("manda system, targetRole e o uid do IdP do ALVO", async () => {
    const rec = createRecordingAuthzCheck();
    const { app, people } = setup(rec.check);
    const personId = await createPerson(app);
    await people.setIdpUserId(personId, "idp-alvo", "alvo@test.com");

    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "people-context", role: "worker" }),
      ),
    );

    expect(res.status).toBe(201);
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]).toEqual({
      resource: "role",
      action: "assign",
      // targetUserId e o uid do IdP, NAO o personId: a policy compara com P.id, que e o
      // `sub` do JWT. E a mesma comparacao que a rota ja faz a mao em ROL-008.
      attr: { system: "people-context", targetRole: "worker", targetUserId: "idp-alvo" },
    });
  });

  it("pessoa sem login ainda nao tem uid — manda string vazia, nao `undefined`", async () => {
    // `undefined` sumiria do JSON e a condicao `P.id != R.attr.targetUserId` quebraria
    // com "no such attribute" em vez de decidir.
    const rec = createRecordingAuthzCheck();
    const { app } = setup(rec.check);
    const personId = await createPerson(app);

    await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "people-context", role: "worker" }),
      ),
    );

    expect(rec.calls[0]?.attr.targetUserId).toBe("");
  });

  it("DENY do PDP vira 403 AUTH-002 e a atribuicao NAO acontece", async () => {
    const deny = createDenyingAuthzCheck();
    const { app, people, roles } = setup(deny.check);
    const personId = await createPerson(app);
    await people.setIdpUserId(personId, "idp-alvo", "alvo@test.com");

    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "people-context", role: "worker" }),
      ),
    );

    expect(res.status).toBe(403);
    const body = await parseJson(res);
    expect((body as unknown as { error: { code: string } }).error.code).toBe("AUTH-002");
    // fail-secure: o PDP e consultado ANTES da escrita
    expect(await roles.listByPerson(personId)).toHaveLength(0);
  });
});

describe("PUT /people/:id/roles/:roleId/(de|re)activate — atributos enviados ao PDP", () => {
  it("deactivate manda o system e o papel da ATRIBUICAO carregada", async () => {
    const rec = createRecordingAuthzCheck();
    const { app, people } = setup(rec.check);
    const personId = await createPerson(app);
    await people.setIdpUserId(personId, "idp-alvo", "alvo@test.com");
    const assigned = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "people-context", role: "owner" }),
      ),
    );
    const roleId = dataAs<IdData>(await parseJson(assigned)).id;
    rec.calls.length = 0;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/deactivate`, {
        method: "PUT",
      }),
    );

    expect(res.status).toBe(204);
    expect(rec.calls[0]).toEqual({
      resource: "role",
      action: "deactivate",
      attr: { system: "people-context", targetRole: "owner", targetUserId: "idp-alvo" },
    });
  });

  it("DENY do PDP no deactivate vira 403 e o papel continua ATIVO", async () => {
    // PDP que libera o assign e reprova o deactivate — assim chegamos ao estado que
    // interessa (papel ativo) e exercitamos so a negacao da remocao.
    const soNegaDeactivate: AuthzCheck = async (_auth, resource, action) =>
      action === "deactivate"
        ? {
            kind: "forbidden",
            status: 403,
            response: {
              success: false,
              error: { code: "AUTH-002", message: `Cerbos negou ${action} em ${resource}` },
            },
          }
        : null;

    const { app, people, roles } = setup(soNegaDeactivate);
    const personId = await createPerson(app);
    await people.setIdpUserId(personId, "idp-alvo", "alvo@test.com");
    const assigned = await app.handle(
      new Request(
        `http://localhost/api/v1/people/${personId}/roles`,
        json({ system: "people-context", role: "owner" }),
      ),
    );
    const roleId = dataAs<IdData>(await parseJson(assigned)).id;

    const res = await app.handle(
      new Request(`http://localhost/api/v1/people/${personId}/roles/${roleId}/deactivate`, {
        method: "PUT",
      }),
    );

    expect(res.status).toBe(403);
    const ativos = await roles.listByPerson(personId, true);
    expect(ativos).toHaveLength(1);
  });
});
