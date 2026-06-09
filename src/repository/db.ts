import postgres, { type Sql } from "postgres";
import { env } from "../config/env.ts";

export type { Sql } from "postgres";

export const createDb = (): Sql =>
  postgres({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    max: 10,
  });

export { migrate } from "./migrations.ts";
