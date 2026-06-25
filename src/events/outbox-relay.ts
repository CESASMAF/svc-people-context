import { connect, Events, type NatsConnection, StringCodec } from "nats";
import type { Sql } from "../repository/db.ts";

// ─── Types ──────────────────────────────────────────────────────

interface OutboxRow {
  readonly id: string;
  readonly subject: string;
  readonly payload: string;
}

export interface OutboxRelay {
  readonly start: () => void;
  readonly stop: () => Promise<void>;
  readonly isConnected: () => boolean;
}

// ─── Constants ──────────────────────────────────────────────────

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 50;
const MAX_RECONNECT_ATTEMPTS = -1; // unlimited
const RECONNECT_WAIT_MS = 2000;

// ─── Relay (polls outbox table, publishes to NATS) ─────────────

export const createOutboxRelay = async (sql: Sql, natsUrl: string): Promise<OutboxRelay> => {
  const sc = StringCodec();
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;

  const nc: NatsConnection = await connect({
    servers: natsUrl,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
    reconnectTimeWait: RECONNECT_WAIT_MS,
  });

  console.log(`[outbox-relay] NATS connected: ${natsUrl}`);

  // Track connection state
  let connected = true;
  void (async () => {
    for await (const status of nc.status()) {
      if (status.type === Events.Disconnect || status.type === Events.Error) {
        connected = false;
        console.warn(`[outbox-relay] NATS ${status.type}: ${JSON.stringify(status.data)}`);
      } else if (status.type === Events.Reconnect) {
        connected = true;
        console.log("[outbox-relay] NATS reconnected");
      }
    }
  })();

  const poll = async (): Promise<void> => {
    if (polling || !connected) return;
    polling = true;

    try {
      const rows = await sql<OutboxRow[]>`
        SELECT id, subject, payload::text
        FROM outbox_events
        WHERE published = false
        ORDER BY created_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return;

      // Publish each event individually — only mark as published on success
      const publishedIds: string[] = [];

      for (const row of rows) {
        try {
          nc.publish(row.subject, sc.encode(row.payload));
          await nc.flush();
          publishedIds.push(row.id);
        } catch (err) {
          console.error(
            `[outbox-relay] Failed to publish event ${row.id}:`,
            err instanceof Error ? err.message : err,
          );
          break;
        }
      }

      if (publishedIds.length > 0) {
        // `sql(array)` expande para uma lista `IN (...)` (Bun.sql). NÃO usar
        // `= ANY(${sql.array(...)})` aqui: serializa como json e o Postgres
        // falha com `operator does not exist: uuid = json`.
        await sql`
          UPDATE outbox_events
          SET published = true, published_at = now()
          WHERE id IN ${sql(publishedIds)}
        `;
        console.log(`[outbox-relay] Published ${publishedIds.length}/${rows.length} event(s)`);
      }
    } catch (err) {
      console.error("[outbox-relay] Poll error:", err instanceof Error ? err.message : err);
    } finally {
      polling = false;
    }
  };

  return {
    start: () => {
      if (timer !== null) return;
      timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
      console.log(`[outbox-relay] Polling every ${POLL_INTERVAL_MS}ms`);
      void poll();
    },
    stop: async () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await nc.drain();
    },
    isConnected: () => connected,
  };
};

// ─── Noop relay (when NATS_URL not set) ─────────────────────────

export const createNoopRelay = (): OutboxRelay => ({
  start: () => {
    console.log("[outbox-relay] NATS_URL not set — relay disabled");
  },
  stop: async () => {
    /* noop — sem conexão NATS para drenar */
  },
  isConnected: () => false,
});
