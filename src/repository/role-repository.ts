import type { Sql } from "./db.ts";
import type { SystemRole, AssignRoleInput } from "../domain/index.ts";

interface PersonSummary {
  readonly id: string;
  readonly fullName: string;
  readonly cpf: string | null;
  readonly birthDate: string;
}

interface RoleQueryResult {
  readonly person: PersonSummary;
  readonly role: SystemRole;
}

export interface RoleRepository {
  readonly assign: (
    personId: string,
    input: AssignRoleInput,
  ) => Promise<{ readonly role: SystemRole; readonly created: boolean }>;
  readonly listByPerson: (personId: string, active?: boolean) => Promise<readonly SystemRole[]>;
  // Code-review HIGH-1: leitura para auth check antes de qualquer mutacao.
  readonly findById: (personId: string, roleId: string) => Promise<SystemRole | null>;
  readonly deactivate: (personId: string, roleId: string) => Promise<SystemRole | null>;
  readonly reactivate: (personId: string, roleId: string) => Promise<SystemRole | null>;
  readonly query: (
    system: string,
    role?: string,
    active?: boolean,
  ) => Promise<readonly RoleQueryResult[]>;
}

export const createRoleRepository = (sql: Sql): RoleRepository => {
  // Lista de colunas como fragmento Bun.sql (composável e seguro — sem `unsafe`).
  const roleFields = sql`id, person_id AS "personId", system, role, active, assigned_at::text AS "assignedAt"`;

  return {
    assign: async (personId, input) => {
      // Wrap in transaction to prevent race condition on UNIQUE(person_id, system, role)
      return sql.begin(async (_tx) => {
        // TransactionSql loses call signature via Omit — cast to Sql for tagged templates
        const tx = _tx as unknown as Sql;

        const [existing] = await tx<SystemRole[]>`
        SELECT ${roleFields} FROM system_roles
        WHERE person_id = ${personId} AND system = ${input.system} AND role = ${input.role}
        FOR UPDATE
      `;

        if (existing !== undefined) {
          if (existing.active) return { role: existing, created: false };
          // Tupla [SystemRole]: UPDATE ... RETURNING por id devolve exatamente 1 linha.
          const [reactivated] = await tx<[SystemRole]>`
          UPDATE system_roles SET active = true WHERE id = ${existing.id}
          RETURNING ${roleFields}
        `;
          return { role: reactivated, created: true };
        }

        // Tupla [SystemRole]: INSERT ... RETURNING devolve exatamente 1 linha.
        const [row] = await tx<[SystemRole]>`
        INSERT INTO system_roles (person_id, system, role)
        VALUES (${personId}, ${input.system}, ${input.role})
        RETURNING ${roleFields}
      `;
        return { role: row, created: true };
      });
    },

    findById: async (personId, roleId) => {
      const [row] = await sql<SystemRole[]>`
      SELECT ${roleFields} FROM system_roles
      WHERE id = ${roleId} AND person_id = ${personId}
    `;
      return row ?? null;
    },

    listByPerson: async (personId, active) => {
      if (active !== undefined) {
        return sql<SystemRole[]>`
        SELECT ${roleFields} FROM system_roles
        WHERE person_id = ${personId} AND active = ${active}
        ORDER BY assigned_at
      `;
      }
      return sql<SystemRole[]>`
      SELECT ${roleFields} FROM system_roles
      WHERE person_id = ${personId}
      ORDER BY assigned_at
    `;
    },

    deactivate: async (personId, roleId) => {
      const [row] = await sql<SystemRole[]>`
      UPDATE system_roles SET active = false
      WHERE id = ${roleId} AND person_id = ${personId} AND active = true
      RETURNING ${roleFields}
    `;
      return row ?? null;
    },

    reactivate: async (personId, roleId) => {
      const [row] = await sql<SystemRole[]>`
      UPDATE system_roles SET active = true
      WHERE id = ${roleId} AND person_id = ${personId} AND active = false
      RETURNING ${roleFields}
    `;
      return row ?? null;
    },

    query: async (system, role, active = true) => {
      const rows = await sql<
        {
          personId: string;
          fullName: string;
          cpf: string | null;
          birthDate: string;
          roleId: string;
          system: string;
          role: string;
          active: boolean;
          assignedAt: string;
        }[]
      >`
      SELECT
        p.id AS "personId", p.full_name AS "fullName", p.cpf, p.birth_date::text AS "birthDate",
        sr.id AS "roleId", sr.system, sr.role, sr.active, sr.assigned_at::text AS "assignedAt"
      FROM system_roles sr
      JOIN people p ON p.id = sr.person_id
      WHERE sr.system = ${system} AND sr.active = ${active}
      ${role !== undefined && role !== "" ? sql`AND sr.role = ${role}` : sql``}
      ORDER BY p.full_name
    `;

      return rows.map((r) => ({
        person: { id: r.personId, fullName: r.fullName, cpf: r.cpf, birthDate: r.birthDate },
        role: {
          id: r.roleId,
          personId: r.personId,
          system: r.system,
          role: r.role,
          active: r.active,
          assignedAt: r.assignedAt,
        },
      }));
    },
  };
};
