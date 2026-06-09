import { Elysia } from "elysia";
import { env } from "./config/env.ts";
import { createDb, migrate } from "./repository/db.ts";
import { createPersonRepository } from "./repository/person-repository.ts";
import { createRoleRepository } from "./repository/role-repository.ts";
import { createJwtVerifier, validateJwks } from "./middleware/jwt.ts";
import { createAuthGuard } from "./middleware/auth.ts";
import { createOutboxPublisher } from "./events/publisher.ts";
import { createOutboxRelay, createNoopRelay } from "./events/outbox-relay.ts";
import { createAuthentikClient, createNoopAuthentikClient } from "./idp/index.ts";
import { createHealthRoutes } from "./routes/health.ts";
import { createPeopleRoutes } from "./routes/people.ts";
import { createRolesRoutes } from "./routes/roles.ts";
import { createAdminRoutes } from "./routes/admin.ts";

// ─── Bootstrap ──────────────────────────────────────────────────

const sql = createDb();
await migrate(sql);
await validateJwks();

const people = createPersonRepository(sql);
const roles = createRoleRepository(sql);
const guard = createAuthGuard(createJwtVerifier());
const publisher = createOutboxPublisher(sql);

// IdP client: Authentik (ADR-027).
const idp =
  env.authentik.baseUrl !== undefined && env.authentik.token !== undefined
    ? createAuthentikClient({
        baseUrl: env.authentik.baseUrl,
        token: env.authentik.token,
      })
    : createNoopAuthentikClient();

if (env.authentik.baseUrl === undefined) {
  console.log("[idp] AUTHENTIK_URL not set — user provisioning disabled (noop client)");
} else {
  console.log(`[idp] Authentik client active (${env.authentik.baseUrl})`);
}

const relay =
  env.nats.url !== undefined ? await createOutboxRelay(sql, env.nats.url) : createNoopRelay();
relay.start();

const app = new Elysia()
  .use(createHealthRoutes({ sql, relay }))
  .use(createPeopleRoutes({ people, guard, publisher, idp }))
  .use(createRolesRoutes({ people, roles, guard, publisher, idp }))
  .use(createAdminRoutes({ people, guard, idp }))
  .listen({ port: env.port, hostname: env.host });

console.log(`people-context running on ${env.host}:${env.port}`);

// ─── Graceful shutdown ──────────────────────────────────────────

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[shutdown] ${signal} received — draining...`);
  await relay.stop();
  await app.stop();
  await sql.close({ timeout: 5 });
  console.log("[shutdown] Clean exit");
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
