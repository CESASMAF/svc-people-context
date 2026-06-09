import type { JwtVerifier, AuthContext } from "./jwt.ts";

// ─── Types (discriminated union for auth results) ───────────────

interface AuthError {
  readonly success: false;
  readonly error: { readonly code: string; readonly message: string };
}

export type AuthResult =
  | { readonly kind: "ok"; readonly auth: AuthContext; readonly actorId: string }
  | { readonly kind: "unauthorized"; readonly status: 401; readonly response: AuthError }
  | { readonly kind: "forbidden"; readonly status: 403; readonly response: AuthError }
  | { readonly kind: "missing-actor"; readonly status: 400; readonly response: AuthError };

// ─── Auth guard (pure function — no framework coupling) ─────────

export type AuthGuard = (
  headers: Record<string, string | undefined>,
  requiredRoles?: readonly string[],
) => Promise<AuthResult>;

export const createAuthGuard =
  (verify: JwtVerifier): AuthGuard =>
  async (headers, requiredRoles) => {
    const authorization = headers["authorization"];
    if (authorization?.startsWith("Bearer ") !== true) {
      return {
        kind: "unauthorized",
        status: 401,
        response: {
          success: false,
          error: { code: "AUTH-001", message: "Authentication required" },
        },
      };
    }

    const auth = await verify(authorization.slice(7));
    if (auth === null) {
      return {
        kind: "unauthorized",
        status: 401,
        response: {
          success: false,
          error: { code: "AUTH-001", message: "Invalid or expired token" },
        },
      };
    }

    if (requiredRoles !== undefined && requiredRoles.length > 0) {
      // "superadmin" bypasses all role checks
      const isSuperAdmin = auth.roles.some((r) => r === "superadmin");
      if (!isSuperAdmin) {
        // Supports both simple ("admin") and composite ("social-care:admin") role keys.
        // A JWT role "social-care:admin" satisfies a guard requiring "admin".
        const hasRole = requiredRoles.some((required) =>
          auth.roles.some((r) => r === required || r.endsWith(`:${required}`)),
        );
        if (!hasRole) {
          return {
            kind: "forbidden",
            status: 403,
            response: {
              success: false,
              error: { code: "AUTH-002", message: `Requires role: ${requiredRoles.join(" or ")}` },
            },
          };
        }
      }
    }

    const actorId = headers["x-actor-id"];
    if (actorId === undefined || actorId === "") {
      return {
        kind: "missing-actor",
        status: 400,
        response: {
          success: false,
          error: { code: "AUTH-003", message: "X-Actor-Id header is required" },
        },
      };
    }

    return { kind: "ok", auth, actorId };
  };
