// Integration oracle — exercita os repositories REAIS contra um Postgres REAL.
// É o oráculo da migração postgres.js → Bun.sql (T-SQL-NATIVE): mesma suíte verde
// com os dois drivers prova paridade. Gated por PG_INTEGRATION (igual ao smoke do
// IdP) para não rodar no `bun test` padrão / CI sem banco.
//
//   docker run -d --name pc-test-pg -e POSTGRES_USER=postgres \
//     -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=people -p 5433:5432 postgres:15
//   PG_INTEGRATION=1 DB_PORT=5433 bun test tests/repository/
//
// Ou, se já houver um Postgres à mão, um BANCO separado nele (não reaproveite o de dev):
//   psql -U postgres -c 'CREATE DATABASE people_test'
//   PG_INTEGRATION=1 DB_NAME=people_test bun test tests/repository/
//
// ⚠️ O suite TRUNCA as tabelas a cada teste. O guard `assertOwnsDatabase` recusa qualquer banco
// que já tenha dados e não esteja marcado como de teste — ver o comentário dele abaixo.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Sql } from "../../src/repository/db.ts";
import type { PersonRepository } from "../../src/repository/person-repository.ts";
import type { RoleRepository } from "../../src/repository/role-repository.ts";

const live = process.env["PG_INTEGRATION"] === "1";

// Aponta para o Postgres de teste ANTES de qualquer import de db.ts/env.ts (feito
// dinamicamente no beforeAll). O IdP (Kratos) nao e tocado por estes testes.
process.env["DB_HOST"] ??= "127.0.0.1";
process.env["DB_PORT"] ??= "5433";
process.env["DB_USER"] ??= "postgres";
process.env["DB_PASSWORD"] ??= "postgres";
process.env["DB_NAME"] ??= "people";
delete process.env["KRATOS_ADMIN_URL"];
delete process.env["KRATOS_ADMIN_TOKEN"];

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

// ─── Guard de banco (2026-08-07) ───────────────────────────────────────────────
//
// Este suite roda `TRUNCATE system_roles, people` a cada teste. Apontá-lo para o banco de
// DESENVOLVIMENTO apaga os dados de trabalho — foi exatamente o que aconteceu ao rodar com
// `DB_PORT=5432` (o default documentado é 5433, um Postgres dedicado). O `PG_INTEGRATION=1`
// sozinho não protege: ele diz "tenho um banco", não "pode destruir este banco".
//
// Regra: o suite só trunca um banco que reconhece como SEU. Ele se apropria de um banco vazio
// (criando a tabela-marcador) e recusa qualquer banco que já tenha dados sem o marcador.
// Reexecuções seguem funcionando, porque o marcador sobrevive ao TRUNCATE das tabelas de negócio.
async function assertOwnsDatabase(sql: Sql): Promise<void> {
  const [marker] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('public.__pc_integration_test_db') IS NOT NULL AS exists
  `;
  if (marker?.exists === true) return;

  const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM people`;
  const count = row?.count ?? 0;
  if (count > 0) {
    const dbName = process.env["DB_NAME"] ?? "people";
    const dbPort = process.env["DB_PORT"] ?? "5433";
    throw new Error(
      `[integration] RECUSANDO rodar: '${dbName}' em :${dbPort} tem ${count} registro(s) em 'people' ` +
        `e nao esta marcado como banco de teste.\n` +
        `Este suite faz TRUNCATE a cada teste — rodar aqui APAGARIA esses dados.\n` +
        `Suba um Postgres dedicado:\n` +
        `  docker run -d --name pc-test-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \\\n` +
        `    -e POSTGRES_DB=people -p 5433:5432 postgres:15\n` +
        `  PG_INTEGRATION=1 DB_PORT=5433 bun test tests/repository/`,
    );
  }

  // banco vazio → o suite se apropria dele.
  await sql`CREATE TABLE IF NOT EXISTS __pc_integration_test_db (created_at timestamptz DEFAULT now())`;
}

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
    await assertOwnsDatabase(sql); // ANTES do primeiro TRUNCATE do beforeEach
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

    // REGRESSAO: omissao nao pode destruir PII. A tela de edicao nem exibia o CPF, entao todo
    // "salvar" mandava o campo ausente e o UPDATE (set-or-null) zerava o CPF da pessoa.
    const semCpf = await people.update(p.id, { fullName: "Bob Sem Cpf", birthDate: "1985-05-05" });
    expect(semCpf?.cpf).toBe("22222222222");
    // string vazia conta como omissao (o form manda "" quando o campo nao foi preenchido)
    const cpfVazio = await people.update(p.id, {
      fullName: "Bob Cpf Vazio",
      cpf: "",
      birthDate: "1985-05-05",
    });
    expect(cpfVazio?.cpf).toBe("22222222222");
    // ...mas um CPF novo continua substituindo o antigo
    const cpfNovo = await people.update(p.id, {
      fullName: "Bob Cpf Novo",
      cpf: "33333333333",
      birthDate: "1985-05-05",
    });
    expect(cpfNovo?.cpf).toBe("33333333333");

    expect(await people.update(UUID_ZERO, { fullName: "X", birthDate: "2000-01-01" })).toBeNull();

    const idp = await people.setIdpUserId(p.id, "kratos-uuid-4242", "bob@idp.com");
    expect(idp?.idpUserId).toBe("kratos-uuid-4242");
    expect(idp?.email).toBe("bob@idp.com");

    expect((await people.deactivate(p.id))?.active).toBe(false);
    expect((await people.reactivate(p.id))?.active).toBe(true);
    expect(await people.deactivate(UUID_ZERO)).toBeNull();
  });

  test("listWithIdpUser só retorna quem tem idp_user_id", async () => {
    const withIdp = await people.create({
      fullName: "HasIdp",
      cpf: "33333333333",
      birthDate: "1991-02-02",
    });
    await people.create({ fullName: "NoIdp", cpf: "44444444444", birthDate: "1992-03-03" });
    await people.setIdpUserId(withIdp.id, "kratos-uuid-1", "has@idp.com");

    const list = await people.listWithIdpUser();
    expect(list.map((x) => x.id)).toContain(withIdp.id);
    expect(list.every((x) => x.idpUserId !== null)).toBe(true);
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
