import { SQL } from "bun";
import { env } from "../config/env.ts";

// Driver nativo do Bun (`Bun.sql`) — substitui postgres.js (ADR docs/adr/0002).
// A interface (factory `createXxxRepository(sql)`) NÃO muda: `Sql` é o tipo do cliente.
export type Sql = SQL;

export const createDb = (): SQL =>
  new SQL({
    adapter: "postgres",
    hostname: env.db.host,
    port: env.db.port,
    username: env.db.user,
    password: env.db.password,
    database: env.db.database,
    max: 10,
  });

export { migrate } from "./migrations.ts";
