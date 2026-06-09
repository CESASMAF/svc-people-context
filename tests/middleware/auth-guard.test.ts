import { describe, it, expect } from "bun:test";
import { createAuthGuard } from "../../src/middleware/auth.ts";
import type { JwtVerifier, AuthContext } from "../../src/middleware/jwt.ts";

// ─── Helpers ────────────────────────────────────────────────────

const validAuth: AuthContext = { sub: "user-1", roles: ["admin", "social_worker"] };
const passingVerifier: JwtVerifier = async () => validAuth;

const guard = createAuthGuard(passingVerifier);

// ─── 401 scenarios ──────────────────────────────────────────────

describe("AuthGuard — 401 Unauthorized", () => {
  it("returns 401 when no Authorization header", async () => {
    const result = await guard({});
    expect(result.kind).toBe("unauthorized");
    if (result.kind === "unauthorized") {
      expect(result.status).toBe(401);
      expect(result.response.error.code).toBe("AUTH-001");
      expect(result.response.error.message).toBe("Authentication required");
    }
  });

  it("returns 401 when Authorization header is not Bearer", async () => {
    const result = await guard({ authorization: "Basic abc123" });
    expect(result.kind).toBe("unauthorized");
  });

  it("returns 401 when token is invalid (verifier returns null)", async () => {
    const rejectingVerifier: JwtVerifier = async () => null;
    const g = createAuthGuard(rejectingVerifier);
    const result = await g({ authorization: "Bearer bad-token", "x-actor-id": "actor" });
    expect(result.kind).toBe("unauthorized");
    if (result.kind === "unauthorized") {
      expect(result.response.error.message).toBe("Invalid or expired token");
    }
  });
});

// ─── 403 scenarios ──────────────────────────────────────────────

describe("AuthGuard — 403 Forbidden", () => {
  it("returns 403 when user lacks required roles", async () => {
    const viewerAuth: AuthContext = { sub: "user-2", roles: ["viewer"] };
    const g = createAuthGuard(async () => viewerAuth);
    const result = await g({ authorization: "Bearer token", "x-actor-id": "actor" }, [
      "admin",
      "social_worker",
    ]);
    expect(result.kind).toBe("forbidden");
    if (result.kind === "forbidden") {
      expect(result.status).toBe(403);
      expect(result.response.error.code).toBe("AUTH-002");
      expect(result.response.error.message).toContain("admin");
      expect(result.response.error.message).toContain("social_worker");
    }
  });

  it("returns 403 when user has empty roles and roles are required", async () => {
    const noRolesAuth: AuthContext = { sub: "user-3", roles: [] };
    const g = createAuthGuard(async () => noRolesAuth);
    const result = await g({ authorization: "Bearer token", "x-actor-id": "actor" }, ["admin"]);
    expect(result.kind).toBe("forbidden");
  });

  it("passes when user has at least one of the required roles", async () => {
    const result = await guard({ authorization: "Bearer token", "x-actor-id": "actor" }, [
      "admin",
      "superadmin",
    ]);
    expect(result.kind).toBe("ok");
  });
});

// ─── 400 scenarios (X-Actor-Id) ─────────────────────────────────

describe("AuthGuard — 400 Missing X-Actor-Id", () => {
  it("returns 400 when X-Actor-Id header is missing", async () => {
    const result = await guard({ authorization: "Bearer token" });
    expect(result.kind).toBe("missing-actor");
    if (result.kind === "missing-actor") {
      expect(result.status).toBe(400);
      expect(result.response.error.code).toBe("AUTH-003");
      expect(result.response.error.message).toBe("X-Actor-Id header is required");
    }
  });

  it("returns 400 when X-Actor-Id is undefined even with valid auth", async () => {
    const result = await guard({ authorization: "Bearer token", "x-actor-id": undefined });
    expect(result.kind).toBe("missing-actor");
  });

  it("passes when X-Actor-Id is present", async () => {
    const result = await guard({ authorization: "Bearer token", "x-actor-id": "actor-99" });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.actorId).toBe("actor-99");
    }
  });
});

// ─── No required roles ──────────────────────────────────────────

describe("AuthGuard — no required roles", () => {
  it("skips role check when requiredRoles is undefined", async () => {
    const result = await guard({ authorization: "Bearer token", "x-actor-id": "actor" });
    expect(result.kind).toBe("ok");
  });

  it("skips role check when requiredRoles is empty array", async () => {
    const result = await guard({ authorization: "Bearer token", "x-actor-id": "actor" }, []);
    expect(result.kind).toBe("ok");
  });
});
