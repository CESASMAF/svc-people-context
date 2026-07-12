import type { JwtVerifier, AuthContext } from "./jwt.ts";
import type { CerbosClient } from "./cerbos.ts";

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
  // X-Actor-Id só é OBRIGATÓRIO em mutações (POST/PUT/DELETE). Leitura (GET)
  // passa `false` e deriva o actorId do JWT.sub (ADR-023).
  requireActor?: boolean,
  // Autorização versionada via Cerbos (opcional). Quando informado E o Cerbos
  // estiver configurado, a decisão do PDP é consultada APÓS o check de role local
  // (defense-in-depth): só pode ADICIONAR negação (DENY explícito → 403); ALLOW
  // ou indeterminado (Cerbos off/erro) deferem ao resultado local.
  authz?: { readonly resource: string; readonly action: string },
) => Promise<AuthResult>;

export const createAuthGuard =
  (verify: JwtVerifier, cerbos?: CerbosClient): AuthGuard =>
  async (headers, requiredRoles, requireActor, authz) => {
    // requireActor default = true (mutações exigem X-Actor-Id); GET passa `false`.
    const requireActorId = requireActor ?? true;
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

    // Cerbos (PDP) — defense-in-depth após o check de role local. DENY explícito
    // barra; ALLOW/indeterminado (Cerbos off/erro) deferem — o Cerbos só ADICIONA
    // negação, nunca concede além do guard local. auth.sub = principal do decision log.
    if (authz !== undefined && cerbos !== undefined) {
      const decision = await cerbos.check(auth.roles, authz.resource, authz.action, auth.sub);
      if (decision === false) {
        return {
          kind: "forbidden",
          status: 403,
          response: {
            success: false,
            error: {
              code: "AUTH-002",
              message: `Cerbos negou ${authz.action} em ${authz.resource}`,
            },
          },
        };
      }
    }

    // actorId = X-Actor-Id (override explícito) OU JWT.sub (ADR-023). O header é
    // OBRIGATÓRIO apenas em mutações (requireActor); leitura deriva do sub.
    const actorHeader = headers["x-actor-id"];
    if (requireActorId && (actorHeader === undefined || actorHeader === "")) {
      return {
        kind: "missing-actor",
        status: 400,
        response: {
          success: false,
          error: { code: "AUTH-003", message: "X-Actor-Id header is required" },
        },
      };
    }
    const actorId = actorHeader !== undefined && actorHeader !== "" ? actorHeader : auth.sub;

    return { kind: "ok", auth, actorId };
  };
