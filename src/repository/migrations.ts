import type { Sql } from "postgres";

// ─── Migration registry (ordered, idempotent) ──────────────────
// Each migration runs inside a transaction. The `schema_migrations`
// table tracks which ones have been applied.

// postgres.js TransactionSql loses the call signature via Omit,
// so we use a minimal callable type for migration functions.
type TaggedSql = (
  template: TemplateStringsArray,
  ...params: readonly unknown[]
) => Promise<unknown[]>;

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: (sql: TaggedSql) => Promise<void>;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "create_people_table",
    up: async (sql) => {
      await sql`
        CREATE TABLE IF NOT EXISTS people (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          full_name   TEXT NOT NULL CHECK (char_length(full_name) > 0),
          cpf         CHAR(11) UNIQUE,
          birth_date  DATE NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_cpf ON people(cpf) WHERE cpf IS NOT NULL`;
    },
  },
  {
    version: 2,
    name: "create_system_roles_table",
    up: async (sql) => {
      await sql`
        CREATE TABLE IF NOT EXISTS system_roles (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          person_id   UUID NOT NULL REFERENCES people(id),
          system      TEXT NOT NULL CHECK (char_length(system) > 0),
          role        TEXT NOT NULL CHECK (char_length(role) > 0),
          active      BOOLEAN NOT NULL DEFAULT true,
          assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (person_id, system, role)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_system_roles_person ON system_roles(person_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_system_roles_query ON system_roles(system, role) WHERE active = true`;
    },
  },
  {
    version: 3,
    name: "create_outbox_events_table",
    up: async (sql) => {
      await sql`
        CREATE TABLE IF NOT EXISTS outbox_events (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          subject      TEXT NOT NULL,
          payload      JSONB NOT NULL,
          published    BOOLEAN NOT NULL DEFAULT false,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          published_at TIMESTAMPTZ
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(created_at) WHERE published = false`;
    },
  },
  {
    version: 4,
    name: "add_zitadel_user_columns",
    up: async (sql) => {
      await sql`ALTER TABLE people ADD COLUMN IF NOT EXISTS email TEXT`;
      await sql`ALTER TABLE people ADD COLUMN IF NOT EXISTS zitadel_user_id TEXT UNIQUE`;
      await sql`ALTER TABLE people ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_zitadel ON people(zitadel_user_id) WHERE zitadel_user_id IS NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_email ON people(email) WHERE email IS NOT NULL`;
    },
  },
  {
    version: 5,
    name: "add_idp_user_pk",
    // ADR-027 + code-review HIGH-6 (2026-05-13): Authentik DRF nao filtra por uid.
    // Persistir tambem o `pk` (integer interno do Authentik) para chamar mutacoes
    // direto em /api/v3/core/users/{pk}/ sem precisar de lookup por uid.
    up: async (sql) => {
      await sql`ALTER TABLE people ADD COLUMN IF NOT EXISTS idp_user_pk INTEGER UNIQUE`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_idp_pk ON people(idp_user_pk) WHERE idp_user_pk IS NOT NULL`;
    },
  },
  {
    version: 6,
    name: "rename_zitadel_to_idp_user_columns",
    // ADR-027 cleanup: remove legado Zitadel da camada de DB. Idempotente via
    // DO/EXCEPTION para suportar ambientes virgens (onde coluna ja foi criada
    // pela migration 4 com nome antigo) e re-runs.
    up: async (sql) => {
      await sql`
        DO $$
        BEGIN
          ALTER TABLE people RENAME COLUMN zitadel_user_id TO idp_user_id;
        EXCEPTION
          WHEN undefined_column THEN NULL;
        END $$
      `;
      await sql`ALTER INDEX IF EXISTS idx_people_zitadel RENAME TO idx_people_idp_user_id`;
    },
  },
];

// ─── Migration runner ──────────────────────────────────────────

export const migrate = async (sql: Sql): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = await sql<{ version: number }[]>`
    SELECT version FROM schema_migrations ORDER BY version
  `;
  const appliedVersions = new Set(applied.map((r) => r.version));

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;

    await sql.begin(async (tx) => {
      await migration.up(tx as unknown as TaggedSql);
      await (tx as unknown as TaggedSql)`
        INSERT INTO schema_migrations (version, name)
        VALUES (${migration.version}, ${migration.name})
      `;
    });

    console.log(`[migrate] Applied migration ${migration.version}: ${migration.name}`);
  }
};
