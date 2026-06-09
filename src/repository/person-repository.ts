import type { Sql } from "postgres";
import type { Person, CreatePersonInput, UpdatePersonInput } from "../domain/index.ts";

interface ListOptions {
  readonly search?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

interface ListResult {
  readonly data: readonly Person[];
  readonly totalCount: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export interface PersonRepository {
  readonly create: (input: CreatePersonInput) => Promise<Person>;
  readonly findById: (id: string) => Promise<Person | null>;
  readonly findByCpf: (cpf: string) => Promise<Person | null>;
  readonly update: (id: string, input: UpdatePersonInput) => Promise<Person | null>;
  readonly list: (options?: ListOptions) => Promise<ListResult>;
  // Persiste credenciais IdP do user provisionado. `idpUserUid` e o `uid`
  // Authentik (vai pro JWT sub); `idpUserPk` e o pk integer (chamadas Management API).
  readonly setIdpUserId: (
    id: string,
    idpUserUid: string,
    idpUserPk: number,
    email: string,
  ) => Promise<Person | null>;
  readonly deactivate: (id: string) => Promise<Person | null>;
  readonly reactivate: (id: string) => Promise<Person | null>;
  // Hard-delete (erasure, LGPD Art. 18 V). Remove roles (FK sem CASCADE) e a
  // pessoa numa unica transacao. Retorna false se a pessoa nao existia.
  readonly remove: (id: string) => Promise<boolean>;
  // Pessoas com login no IdP — usado pela reconciliacao IdP<->DB.
  readonly listWithIdpUser: () => Promise<readonly Person[]>;
}

const SELECT_FIELDS = `
  id, full_name AS "fullName", cpf, birth_date::text AS "birthDate",
  email, idp_user_id AS "idpUserId", idp_user_pk AS "idpUserPk", active,
  created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

export const createPersonRepository = (sql: Sql): PersonRepository => ({
  create: async (input) => {
    // Tupla [Person]: INSERT ... RETURNING devolve exatamente 1 linha → row é Person (não undefined).
    const [row] = await sql<[Person]>`
      INSERT INTO people (full_name, cpf, birth_date, email)
      VALUES (${input.fullName}, ${input.cpf ?? null}, ${input.birthDate}, ${input.email ?? null})
      RETURNING ${sql.unsafe(SELECT_FIELDS)}
    `;
    return row;
  },

  findById: async (id) => {
    const [row] = await sql<Person[]>`
      SELECT ${sql.unsafe(SELECT_FIELDS)} FROM people WHERE id = ${id}
    `;
    return row ?? null;
  },

  findByCpf: async (cpf) => {
    const [row] = await sql<Person[]>`
      SELECT ${sql.unsafe(SELECT_FIELDS)} FROM people WHERE cpf = ${cpf}
    `;
    return row ?? null;
  },

  update: async (id, input) => {
    // email: COALESCE preserva o valor atual quando o update nao informa email
    // (PUT sem email nao apaga o login existente). cpf segue o padrao set-or-null.
    const [row] = await sql<Person[]>`
      UPDATE people
      SET full_name = ${input.fullName},
          cpf = ${input.cpf ?? null},
          birth_date = ${input.birthDate},
          email = COALESCE(${input.email ?? null}, email),
          updated_at = now()
      WHERE id = ${id}
      RETURNING ${sql.unsafe(SELECT_FIELDS)}
    `;
    return row ?? null;
  },

  setIdpUserId: async (id, idpUserUid, idpUserPk, email) => {
    const [row] = await sql<Person[]>`
      UPDATE people
      SET idp_user_id = ${idpUserUid},
          idp_user_pk = ${idpUserPk},
          email = ${email},
          updated_at = now()
      WHERE id = ${id}
      RETURNING ${sql.unsafe(SELECT_FIELDS)}
    `;
    return row ?? null;
  },

  deactivate: async (id) => {
    const [row] = await sql<Person[]>`
      UPDATE people SET active = false, updated_at = now()
      WHERE id = ${id} AND active = true
      RETURNING ${sql.unsafe(SELECT_FIELDS)}
    `;
    return row ?? null;
  },

  reactivate: async (id) => {
    const [row] = await sql<Person[]>`
      UPDATE people SET active = true, updated_at = now()
      WHERE id = ${id} AND active = false
      RETURNING ${sql.unsafe(SELECT_FIELDS)}
    `;
    return row ?? null;
  },

  remove: async (id) => {
    // FK system_roles.person_id NAO tem ON DELETE CASCADE — removemos os roles
    // antes da pessoa, na mesma transacao, para evitar violacao de FK.
    return sql.begin(async (_tx) => {
      const tx = _tx as unknown as Sql;
      await tx`DELETE FROM system_roles WHERE person_id = ${id}`;
      const deleted = await tx<Person[]>`
        DELETE FROM people WHERE id = ${id}
        RETURNING ${sql.unsafe(SELECT_FIELDS)}
      `;
      return deleted.length > 0;
    });
  },

  listWithIdpUser: async () =>
    sql<Person[]>`
      SELECT ${sql.unsafe(SELECT_FIELDS)} FROM people
      WHERE idp_user_pk IS NOT NULL
      ORDER BY id
    `,

  list: async (options = {}) => {
    const limit = Math.min(options.limit ?? 20, 100);
    const search = options.search?.trim();
    const hasSearch = search !== undefined && search !== "";
    const cursor =
      options.cursor !== undefined && options.cursor !== "" ? options.cursor : undefined;

    const [countRow] = await sql<[{ count: string }]>`
      SELECT count(*)::text AS count FROM people
      ${hasSearch ? sql`WHERE (full_name ILIKE ${"%" + search + "%"} OR cpf LIKE ${search + "%"})` : sql``}
    `;
    const totalCount = Number(countRow.count);

    const rows = await sql<Person[]>`
      SELECT ${sql.unsafe(SELECT_FIELDS)} FROM people
      WHERE true
      ${hasSearch ? sql`AND (full_name ILIKE ${"%" + search + "%"} OR cpf LIKE ${search + "%"})` : sql``}
      ${cursor !== undefined ? sql`AND id > ${cursor}` : sql``}
      ORDER BY id
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const last = data.at(-1);
    const nextCursor = hasMore && last !== undefined ? last.id : null;

    return { data, totalCount, hasMore, nextCursor };
  },
});
