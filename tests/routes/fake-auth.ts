import type { AuthGuard, AuthResult } from "../../src/middleware/auth.ts";

// Guard that always passes — for testing routes without real JWT
export const createFakeAuthGuard = (): AuthGuard => async (): Promise<AuthResult> => ({
  kind: "ok",
  auth: { sub: "test-user", roles: ["admin"] },
  actorId: "test-actor",
});

// Guard with configurable roles and sub — for testing RBAC rules
export const createFakeAuthGuardWithRoles =
  (roles: string[], sub = "test-user", actorId = "test-actor"): AuthGuard =>
  async (): Promise<AuthResult> => ({
    kind: "ok",
    auth: { sub, roles },
    actorId,
  });

// Guard that always rejects — for testing 401
export const createRejectingAuthGuard = (): AuthGuard => async (): Promise<AuthResult> => ({
  kind: "unauthorized",
  status: 401,
  response: { success: false, error: { code: "AUTH-001", message: "Authentication required" } },
});
