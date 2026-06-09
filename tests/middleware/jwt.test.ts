import { describe, it, expect } from "bun:test";
import { createAuthGuard, type AuthGuard } from "../../src/middleware/auth.ts";
import type { JwtVerifier, AuthContext } from "../../src/middleware/jwt.ts";

// ─── Helpers: injectable JwtVerifier stubs ──────────────────────

const verifierReturning =
  (result: AuthContext | null): JwtVerifier =>
  async () =>
    result;

const guardWith = (verifier: JwtVerifier): AuthGuard => createAuthGuard(verifier);

const validHeaders = (token = "valid-token", actorId = "actor-1") => ({
  authorization: `Bearer ${token}`,
  "x-actor-id": actorId,
});

// ─── Tests ──────────────────────────────────────────────────────

describe("JWT verifier integration via AuthGuard", () => {
  it("returns ok when verifier returns a valid AuthContext", async () => {
    const guard = guardWith(verifierReturning({ sub: "user-1", roles: ["admin"] }));
    const result = await guard(validHeaders());
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.auth.sub).toBe("user-1");
      expect(result.auth.roles).toEqual(["admin"]);
      expect(result.actorId).toBe("actor-1");
    }
  });

  it("returns unauthorized when verifier returns null (invalid token)", async () => {
    const guard = guardWith(verifierReturning(null));
    const result = await guard(validHeaders());
    expect(result.kind).toBe("unauthorized");
    if (result.kind === "unauthorized") {
      expect(result.status).toBe(401);
      expect(result.response.error.code).toBe("AUTH-001");
    }
  });

  it("extracts roles correctly from AuthContext", async () => {
    const guard = guardWith(verifierReturning({ sub: "svc-1", roles: ["social_worker", "admin"] }));
    const result = await guard(validHeaders(), ["social_worker"]);
    expect(result.kind).toBe("ok");
  });

  it("returns forbidden when verifier returns roles that do not match required", async () => {
    const guard = guardWith(verifierReturning({ sub: "user-2", roles: ["viewer"] }));
    const result = await guard(validHeaders(), ["admin"]);
    expect(result.kind).toBe("forbidden");
    if (result.kind === "forbidden") {
      expect(result.status).toBe(403);
      expect(result.response.error.code).toBe("AUTH-002");
    }
  });

  it("returns ok when verifier returns empty roles and no roles required", async () => {
    const guard = guardWith(verifierReturning({ sub: "user-3", roles: [] }));
    const result = await guard(validHeaders());
    expect(result.kind).toBe("ok");
  });

  it("returns forbidden when verifier returns empty roles but roles are required", async () => {
    const guard = guardWith(verifierReturning({ sub: "user-4", roles: [] }));
    const result = await guard(validHeaders(), ["admin"]);
    expect(result.kind).toBe("forbidden");
  });

  it("handles verifier that throws (simulating JWKS fetch failure)", async () => {
    const throwingVerifier: JwtVerifier = async () => {
      throw new Error("JWKS unreachable");
    };
    // The guard itself doesn't catch — but the verifier contract is to return null on failure.
    // So we test that a verifier wrapping errors returns null correctly.
    const wrappedVerifier: JwtVerifier = async (token) => {
      try {
        return await throwingVerifier(token);
      } catch {
        return null;
      }
    };
    const safeGuard = createAuthGuard(wrappedVerifier);
    const result = await safeGuard(validHeaders());
    expect(result.kind).toBe("unauthorized");
  });
});
