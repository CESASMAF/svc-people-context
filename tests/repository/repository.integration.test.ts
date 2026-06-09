// Integration oracle — exercita os repositories REAIS contra um Postgres REAL.
// É o oráculo da migração postgres.js → Bun.sql (T-SQL-NATIVE): mesma suíte verde
// com os dois drivers prova paridade. Gated por PG_INTEGRATION (igual ao smoke do
// IdP) para não rodar no `bun test` padrão / CI sem banco.
//
//   docker run -d --name pc-test-pg -e POSTGRES_USER=postgres \
//     -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=people -p 5433:5432 postgres:15
//   PG_INTEGRATION=1 DB_PORT=5433 bun test tests/repository/

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Sql } from "../../src/repository/db.ts";
import type { PersonRepository } from "../../src/repository/person-repository.ts";
import type { RoleRepository } from "../../src/repository/role-repository.ts";

const live = process.env["PG_INTEGRATION"] === "1";

// Aponta para o Postgres de teste e neutraliza o XOR do env (Authentik) ANTES de
// qualquer import de db.ts/env.ts (feito dinamicamente no beforeAll).
process.env["DB_HOST"] ??= "127.0.0.1";
process.env["DB_PORT"] ??= "5433";
process.env["DB_USER"] ??= "postgres";
process.env["DB_PASSWORD"] ??= "postgres";
process.env["DB_NAME"] ??= "people";
delete process.env["AUTHENTIK_URL"];
delete process.env["AUTHENTIK_TOKEN"];

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

describe.skipIf(!live)("repository integration (Postgres real)", () => {
  let sql: Sql;
  let people: PersonRepository;
  let roles: RoleRepository;

  beforeAll(async () => {
    const dbMod = await import("../../src/repository/db.ts");
    const personMod = await import("../../src/repository/person-repository.ts");
    const roleMod = await import("../../src/repository/role-repository.ts");
    sql = dbMod.createDb();
    await dbMod.migrate(sql);
    people = personMod.createPersonRepository(sql);
    roles = roleMod.createRoleRepository(sql);
  });

  afterAll(async () => {
    if (sql !== undefined) await sql.close({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`TRUNCATE system_roles, people RESTART IDENTITY CASCADE`;
  });

  // ─── Person ────────────────────────────────────────────────────

  test("create → findById → findByCpf (tagged template + sql.unsafe fragment)", async () => {
    const created = await people.create({
      fullName: "Ana Integration",
      cpf: "11111111111",
      birthDate: "1990-01-01",
      email: "ana@example.com",
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.fullName).toBe("Ana Integration");
    expect(created.cpf).toBe("11111111111");
    expect(created.active).toBe(true);
    expect(created.idpUserId).toBeNull();
    expect(created.idpUserPk).toBeNull();

    const byId = await people.findById(created.id);
    expect(byId?.fullName).toBe("Ana Integration");
    const byCpf = await people.findByCpf("11111111111");
    expect(byCpf?.id).toBe(created.id);
    expect(await people.findById(UUID_ZERO)).toBeNull();
    expect(await people.findByCpf("99999999999")).toBeNull();
  });

  test("update → setIdpUserId → deactivate → reactivate (Person | null)", async () => {
    const p = await people.create({
      fullName: "Bob",
      cpf: "22222222222",
      birthDate: "1985-05-05",
    });

    const updated = await people.update(p.id, {
      fullName: "Bob Updated",
      cpf: "22222222222",
      birthDate: "1985-05-05",
    });
    expect(updated?.fullName).toBe("Bob Updated");
    expect(await people.update(UUID_ZERO, { fullName: "X", birthDate: "2000-01-01" })).toBeNull();

    const idp = await people.setIdpUserId(p.id, "uid-hex-64", 4242, "bob@idp.com");
    expect(idp?.idpUserId).toBe("uid-hex-64");
    expect(idp?.idpUserPk).toBe(4242);
    expect(idp?.email).toBe("bob@idp.com");

    expect((await people.deactivate(p.id))?.active).toBe(false);
    expect((await people.reactivate(p.id))?.active).toBe(true);
    expect(await people.deactivate(UUID_ZERO)).toBeNull();
  });

  test("listWithIdpUser só retorna quem tem idp_user_pk", async () => {
    const withIdp = await people.create({
      fullName: "HasIdp",
      cpf: "33333333333",
      birthDate: "1991-02-02",
    });
    await people.create({ fullName: "NoIdp", cpf: "44444444444", birthDate: "1992-03-03" });
    await people.setIdpUserId(withIdp.id, "uid-1", 1, "has@idp.com");

    const list = await people.listWithIdpUser();
    expect(list.map((x) => x.id)).toContain(withIdp.id);
    expect(list.every((x) => x.idpUserPk !== null)).toBe(true);
  });

  test("list: paginação por cursor + busca + totalCount", async () => {
    for (let i = 0; i < 5; i++) {
      await people.create({
        fullName: `Person ${i}`,
        cpf: `5000000000${i}`,
        birthDate: "1990-01-01",
      });
    }
    const page1 = await people.list({ limit: 2 });
    expect(page1.data.length).toBe(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.totalCount).toBe(5);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await people.list({ limit: 2, cursor: page1.nextCursor ?? undefined });
    expect(page2.data.length).toBe(2);
    expect(page2.data[0]?.id).not.toBe(page1.data[0]?.id);

    const search = await people.list({ search: "Person 3" });
    expect(search.data.length).toBe(1);
    expect(search.data[0]?.fullName).toBe("Person 3");
  });

  test("remove (sql.begin tx: apaga roles + pessoa) é idempotente", async () => {
    const p = await people.create({
      fullName: "Erase Me",
      cpf: "66666666666",
      birthDate: "1990-01-01",
    });
    await roles.assign(p.id, { system: "social-care", role: "patient" });

    expect(await people.remove(p.id)).toBe(true);
    expect(await people.findById(p.id)).toBeNull();
    expect(await people.remove(p.id)).toBe(false);
    expect(await people.remove(UUID_ZERO)).toBe(false);
  });

  // ─── Roles ─────────────────────────────────────────────────────

  test("assign: tx + idempotência + reativação de role inativa", async () => {
    const p = await people.create({
      fullName: "Role Owner",
      cpf: "77777777777",
      birthDate: "1990-01-01",
    });

    const first = await roles.assign(p.id, { system: "social-care", role: "professional" });
    expect(first.created).toBe(true);
    expect(first.role.active).toBe(true);
    expect(first.role.system).toBe("social-care");

    const again = await roles.assign(p.id, { system: "social-care", role: "professional" });
    expect(again.created).toBe(false); // já existe e está ativa → no-op

    expect(await roles.findById(p.id, first.role.id)).not.toBeNull();
    expect((await roles.listByPerson(p.id)).length).toBe(1);

    expect((await roles.deactivate(p.id, first.role.id))?.active).toBe(false);
    expect((await roles.reactivate(p.id, first.role.id))?.active).toBe(true);

    await roles.deactivate(p.id, first.role.id);
    const reassigned = await roles.assign(p.id, { system: "social-care", role: "professional" });
    expect(reassigned.created).toBe(true); // reativa a inativa
    expect(reassigned.role.active).toBe(true);
  });

  test("query: JOIN people+roles por system/role/active", async () => {
    const p = await people.create({
      fullName: "Queried",
      cpf: "88888888888",
      birthDate: "1990-01-01",
    });
    await roles.assign(p.id, { system: "queue-manager", role: "employee" });

    const bySystem = await roles.query("queue-manager", undefined, true);
    expect(bySystem.map((r) => r.person.id)).toContain(p.id);
    expect(bySystem[0]?.person.fullName).toBe("Queried");
    expect(bySystem[0]?.role.role).toBe("employee");

    const byRole = await roles.query("queue-manager", "employee", true);
    expect(byRole.length).toBe(1);
    expect(await roles.query("queue-manager", "nonexistent", true)).toEqual([]);
  });
});
