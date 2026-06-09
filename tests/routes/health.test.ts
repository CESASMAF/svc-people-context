import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createHealthRoutes } from "../../src/routes/health.ts";
import type { OutboxRelay } from "../../src/events/outbox-relay.ts";

// ─── Fakes ─────────────────────────────────────────────────────

const createFakeSql = (shouldFail = false) => {
  const handler = ((_strings: TemplateStringsArray, ..._params: unknown[]) => {
    if (shouldFail) throw new Error("connection refused");
    return Promise.resolve([{ "?column?": 1, count: "0" }]);
  }) as unknown as import("postgres").Sql;
  return handler;
};

const createFakeRelay = (connected = true): OutboxRelay => ({
  start: () => {},
  stop: async () => {},
  isConnected: () => connected,
});

// ─── Tests ─────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with alive status", async () => {
    const app = new Elysia().use(
      createHealthRoutes({ sql: createFakeSql(), relay: createFakeRelay() }),
    );
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("alive");
  });
});

describe("GET /ready", () => {
  it("returns 200 when database is reachable", async () => {
    const app = new Elysia().use(
      createHealthRoutes({ sql: createFakeSql(), relay: createFakeRelay() }),
    );
    const res = await app.handle(new Request("http://localhost/ready"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: Record<string, string> };
    expect(body.status).toBe("ready");
    expect(body.checks.database).toBe("ok");
    expect(body.checks.nats).toBe("ok");
  });

  it("returns 503 when database is unreachable", async () => {
    const app = new Elysia().use(
      createHealthRoutes({ sql: createFakeSql(true), relay: createFakeRelay() }),
    );
    const res = await app.handle(new Request("http://localhost/ready"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; checks: Record<string, string> };
    expect(body.status).toBe("unavailable");
    expect(body.checks.database).toBe("unavailable");
  });

  it("reports nats disconnected when relay is not connected", async () => {
    const app = new Elysia().use(
      createHealthRoutes({ sql: createFakeSql(), relay: createFakeRelay(false) }),
    );
    const res = await app.handle(new Request("http://localhost/ready"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: Record<string, string> };
    expect(body.checks.nats).toBe("disconnected");
  });
});
