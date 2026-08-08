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

// ─── Bypass de superadmin ───────────────────────────────────────
//
// Casa `superadmin` bare E `<qualquer-coisa>:superadmin`, porque é assim que o Cerbos decide:
// o derived role de `_common_roles.yaml` é
//   P.roles.exists(r, r == "superadmin" || r.endsWith(":superadmin"))
// e o comentário de lá diz, explicitamente, que o papel "pode vir sem sistema ou com qualquer
// prefixo". A igualdade exata que estava aqui divergia dessa definição: uma identidade com
// `people-context:superadmin` era CONCEDIDA pelo PDP e NEGADA pelo guard local, com um
// AUTH-002 dizendo que faltava o papel `admin` — o superadmin trancado fora das rotas
// administrativas por um erro que aponta para o lugar errado.
//
// Duas metades de um mesmo defense-in-depth precisam concordar sobre quem é superadmin.
export const hasSuperAdmin = (roles: readonly string[]): boolean =>
  roles.some((r) => r === "superadmin" || r.endsWith(":superadmin"));

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
  //
  // `resource`/`action` vêm de `policy-actions.ts` — string livre aqui foi o que
  // derrubou produção em 2026-08-08 (recurso inexistente = DENY silencioso).
  // `attr` alimenta as condições da policy (`R.attr.*`); obrigatório em `role`.
  authz?: {
    readonly resource: string;
    readonly action: string;
    readonly attr?: Readonly<Record<string, string>>;
  },
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
      const isSuperAdmin = hasSuperAdmin(auth.roles);
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
      const decision = await cerbos.check({
        roles: auth.roles,
        resource: authz.resource,
        action: authz.action,
        principalId: auth.sub,
        ...(authz.attr !== undefined ? { attr: authz.attr } : {}),
      });
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

// ─── AuthZ em DUAS FASES (rotas de papel) ───────────────────────
//
// `role.yaml` decide por atributos do RECURSO (`R.attr.system`, `R.attr.targetRole`,
// `R.attr.targetUserId`), e nenhum deles é conhecido no início da requisição: no POST
// vêm do body validado; nos PUT, da atribuição carregada do banco. Por isso essas rotas
// chamam `guard` SEM `authz` (JWT + role local + X-Actor-Id) e consultam o PDP aqui,
// depois — em vez de mandar um check incompleto, que a policy negaria.
//
// Devolve `null` quando pode seguir (ALLOW ou indeterminado) e o próprio `forbidden`
// quando o PDP negou — mesma forma do guard, para a rota só repassar.

export type AuthzCheck = (
  auth: AuthContext,
  resource: string,
  action: string,
  attr: Readonly<Record<string, string>>,
) => Promise<Extract<AuthResult, { kind: "forbidden" }> | null>;

export const createAuthzCheck =
  (cerbos?: CerbosClient): AuthzCheck =>
  async (auth, resource, action, attr) => {
    if (cerbos === undefined) return null;
    const decision = await cerbos.check({
      roles: auth.roles,
      resource,
      action,
      principalId: auth.sub,
      attr,
    });
    if (decision !== false) return null;
    return {
      kind: "forbidden",
      status: 403,
      response: {
        success: false,
        error: { code: "AUTH-002", message: `Cerbos negou ${action} em ${resource}` },
      },
    };
  };
