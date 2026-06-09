import { Elysia } from "elysia";
import type { Sql } from "postgres";
import type { OutboxRelay } from "../events/outbox-relay.ts";

const OUTBOX_BACKLOG_THRESHOLD = 1000;

interface HealthDeps {
  readonly sql: Sql;
  readonly relay: OutboxRelay;
}

export const createHealthRoutes = ({ sql, relay }: HealthDeps) =>
  new Elysia()
    .get("/health", () => ({ status: "alive" }))
    .get("/ready", async ({ set }) => {
      const checks: Record<string, string> = {};

      // Database connectivity
      try {
        await sql`SELECT 1`;
        checks.database = "ok";
      } catch {
        checks.database = "unavailable";
      }

      // NATS relay connection
      checks.nats = relay.isConnected() ? "ok" : "disconnected";

      // Outbox backlog
      try {
        const [row] = await sql<[{ count: string }]>`
          SELECT count(*)::text AS count FROM outbox_events WHERE published = false
        `;
        const backlog = Number(row.count);
        checks.outboxBacklog = String(backlog);
        if (backlog > OUTBOX_BACKLOG_THRESHOLD) {
          checks.outbox = "backlog_high";
        } else {
          checks.outbox = "ok";
        }
      } catch {
        checks.outbox = "unavailable";
      }

      const healthy = checks.database === "ok";
      if (!healthy) {
        set.status = 503;
        return { status: "unavailable", checks };
      }

      return { status: "ready", checks };
    });
