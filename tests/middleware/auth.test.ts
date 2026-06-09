import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createPeopleRoutes } from "../../src/routes/people.ts";
import { createFakePersonRepository } from "../routes/fake-repositories.ts";
import { createRejectingAuthGuard } from "../routes/fake-auth.ts";
import { createFakePublisher } from "../routes/fake-publisher.ts";
import { createNoopAuthentikClient } from "../../src/idp/index.ts";
import { createAuthGuard } from "../../src/middleware/auth.ts";
import type { JwtVerifier } from "../../src/middleware/jwt.ts";

const setup = () => {
  const people = createFakePersonRepository();
  const guard = createRejectingAuthGuard();
  const publisher = createFakePublisher();
  const idp = createNoopAuthentikClient();
  const app = new Elysia().use(createPeopleRoutes({ people, guard, publisher, idp }));
  return { app };
};

describe("Auth guard — all endpoints require authentication", () => {
  it("returns 401 on POST /people when auth fails", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: "Ana Costa", birthDate: "1990-05-15" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 on PUT /people/:id when auth fails", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/00000000-0000-0000-0000-000000000000", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: "Ana", birthDate: "1990-05-15" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 on GET /people when auth fails", async () => {
    const { app } = setup();
    const res = await app.handle(new Request("http://localhost/api/v1/people"));
    expect(res.status).toBe(401);
  });

  it("returns 401 on GET /people/:id when auth fails", async () => {
    const { app } = setup();
    const res = await app.handle(
      new Request("http://localhost/api/v1/people/00000000-0000-0000-0000-000000000000"),
    );
    expect(res.status).toBe(401);
  });
});

describe("Auth guard — composite role matching", () => {
  const fakeVerifier =
    (roles: string[]): JwtVerifier =>
    async () => ({ sub: "test-user", roles });

  it("matches simple role exactly", async () => {
    const guard = createAuthGuard(fakeVerifier(["admin"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["admin"]);
    expect(result.kind).toBe("ok");
  });

  it("matches composite role 'social-care:admin' when guard requires 'admin'", async () => {
    const guard = createAuthGuard(fakeVerifier(["social-care:admin"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["admin"]);
    expect(result.kind).toBe("ok");
  });

  it("matches composite role 'social-care:worker' when guard requires 'worker'", async () => {
    const guard = createAuthGuard(fakeVerifier(["social-care:worker"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["worker"]);
    expect(result.kind).toBe("ok");
  });

  it("rejects when no role matches", async () => {
    const guard = createAuthGuard(fakeVerifier(["social-care:viewer"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["admin"]);
    expect(result.kind).toBe("forbidden");
  });

  it("matches when one of multiple required roles is present", async () => {
    const guard = createAuthGuard(fakeVerifier(["queue-manager:owner"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, [
      "worker",
      "owner",
      "admin",
    ]);
    expect(result.kind).toBe("ok");
  });

  it("matches mixed simple and composite roles", async () => {
    const guard = createAuthGuard(fakeVerifier(["admin", "social-care:worker"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["worker"]);
    expect(result.kind).toBe("ok");
  });

  it("superadmin bypasses all role checks", async () => {
    const guard = createAuthGuard(fakeVerifier(["superadmin"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, ["admin"]);
    expect(result.kind).toBe("ok");
  });

  it("superadmin bypasses even with unrelated required roles", async () => {
    const guard = createAuthGuard(fakeVerifier(["superadmin"]));
    const result = await guard({ authorization: "Bearer fake", "x-actor-id": "actor" }, [
      "worker",
      "owner",
    ]);
    expect(result.kind).toBe("ok");
  });
});
