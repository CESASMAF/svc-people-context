import { Elysia } from "elysia";
import { env } from "./config/env.ts";
import { createDb, migrate } from "./repository/db.ts";
import { createPersonRepository } from "./repository/person-repository.ts";
import { createRoleRepository } from "./repository/role-repository.ts";
import { createJwtVerifier, validateJwks } from "./middleware/jwt.ts";
import { createAuthGuard, createAuthzCheck } from "./middleware/auth.ts";
import { createCerbosClient, createNoopCerbosClient } from "./middleware/cerbos.ts";
import { createOutboxPublisher } from "./events/publisher.ts";
import { createOutboxRelay, createNoopRelay } from "./events/outbox-relay.ts";
import { createIdpClient, createNoopIdpClient } from "./idp/index.ts";
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
const cerbos =
  env.cerbos.url !== undefined ? createCerbosClient(env.cerbos.url) : createNoopCerbosClient();
if (env.cerbos.url !== undefined) {
  console.log(`[cerbos] PDP ativo (${env.cerbos.url}) — RBAC versionado (defense-in-depth)`);
} else {
  console.log("[cerbos] CERBOS_URL não setado — RBAC apenas via guard local");
}
const guard = createAuthGuard(createJwtVerifier(), cerbos);
const authz = createAuthzCheck(cerbos);
const publisher = createOutboxPublisher(sql);

// IdP client: Ory Kratos Admin API. A Admin API não exige Bearer (isolação de
// rede); `kratosAdminToken` só é enviado se um proxy com token for posto na frente.
const idp =
  env.ory.kratosAdminUrl !== undefined
    ? createIdpClient({
        baseUrl: env.ory.kratosAdminUrl,
        ...(env.ory.kratosAdminToken !== undefined ? { token: env.ory.kratosAdminToken } : {}),
      })
    : createNoopIdpClient();

if (env.ory.kratosAdminUrl === undefined) {
  console.log("[idp] KRATOS_ADMIN_URL not set — user provisioning disabled (noop client)");
} else {
  console.log(`[idp] Kratos IdP client active (${env.ory.kratosAdminUrl})`);
}

const relay =
  env.nats.url !== undefined ? await createOutboxRelay(sql, env.nats.url) : createNoopRelay();
relay.start();

const app = new Elysia()
  .use(createHealthRoutes({ sql, relay }))
  .use(createPeopleRoutes({ people, roles, guard, publisher, idp }))
  .use(createRolesRoutes({ people, roles, guard, authz, publisher, idp }))
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
