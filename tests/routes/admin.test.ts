import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createAdminRoutes } from "../../src/routes/admin.ts";
import { createFakePersonRepository } from "./fake-repositories.ts";
import { createFakeAuthGuard, createFakeAuthGuardWithRoles } from "./fake-auth.ts";
import { createFakeIdpClient, type FakeIdpOverrides } from "./fake-idp.ts";
import type { AuthGuard } from "../../src/middleware/auth.ts";
import { parseJson } from "./test-types.ts";

const setup = (opts: { idp?: FakeIdpOverrides; guard?: AuthGuard } = {}) => {
  const people = createFakePersonRepository();
  const guard = opts.guard ?? createFakeAuthGuardWithRoles(["superadmin"]);
  const idp = createFakeIdpClient(opts.idp ?? {});
  const app = new Elysia().use(createAdminRoutes({ people, guard, idp }));
  return { app, people, idp };
};

const url = "http://localhost/api/v1/admin/reconcile-idp";

interface ReconcileReport {
  readonly checked: number;
  readonly inSync: number;
  readonly fixed: readonly { personId: string }[];
  readonly errors: readonly { personId: string }[];
}

describe("POST /api/v1/admin/reconcile-idp", () => {
  it("reconcilia e corrige divergencias (superadmin)", async () => {
    // p-1 ativo no DB, mas inativo no IdP → deve reativar.
    const { app, people } = setup({ idp: { getUserActiveById: { "id-201": false } } });
    const id1 = (await people.create({ fullName: "Ativo", birthDate: "2000-01-01" })).id;
    await people.setIdpUserId(id1, "id-201", "a@x.com");

    const res = await app.handle(new Request(url, { method: "POST" }));

    expect(res.status).toBe(200);
    const report = (await parseJson(res)).data as ReconcileReport;
    expect(report.checked).toBe(1);
    expect(report.fixed.length).toBe(1);
  });

  it("ignora pessoas sem login no IdP", async () => {
    const { app, people } = setup();
    await people.create({ fullName: "Sem Login", birthDate: "2000-01-01" });

    const res = await app.handle(new Request(url, { method: "POST" }));

    expect(res.status).toBe(200);
    const report = (await parseJson(res)).data as ReconcileReport;
    expect(report.checked).toBe(0);
  });

  it("retorna 403 quando o caller nao e superadmin", async () => {
    const { app } = setup({ guard: createFakeAuthGuard() }); // roles: ["admin"]
    const res = await app.handle(new Request(url, { method: "POST" }));
    expect(res.status).toBe(403);
    const body = (await parseJson(res)) as unknown as { error: { code: string } };
    expect(body.error.code).toBe("ADM-001");
  });
});
