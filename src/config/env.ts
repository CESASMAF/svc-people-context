// ─── Raw env reading ───────────────────────────────────────────

const isProduction = process.env["NODE_ENV"] === "production";

const requireInProd = (key: string, fallback: string): string => {
  const value = process.env[key];
  if (value) return value;
  if (isProduction) throw new Error(`[env] ${key} is required in production`);
  return fallback;
};

// ─── OIDC issuer/JWKS — alvo: Authentik self-hosted (deploy BV) ──
//
// Os endpoints OIDC do Authentik sao derivados da application:
//   issuer  = <AUTHENTIK_URL>/application/o/<slug>/
//   jwks    = <AUTHENTIK_URL>/application/o/<slug>/jwks/
// (ref-authentik: add-secure-apps/providers/oauth2/index.mdx — "OAuth2 endpoints").
//
// Derivamos de AUTHENTIK_URL + AUTHENTIK_APP_SLUG; OIDC_ISSUER / JWKS_URL
// permitem override explicito (ex: provider num dominio distinto do core).
const authentikBaseRaw = process.env["AUTHENTIK_URL"];
const authentikBase = authentikBaseRaw?.replace(/\/+$/, "");
const oidcAppSlug = process.env["AUTHENTIK_APP_SLUG"] ?? "people-context";
const derivedIssuer = authentikBase ? `${authentikBase}/application/o/${oidcAppSlug}/` : undefined;
const derivedJwks = authentikBase
  ? `${authentikBase}/application/o/${oidcAppSlug}/jwks/`
  : undefined;

const resolveOidc = (key: string, derived: string | undefined, devFallback: string): string => {
  const explicit = process.env[key];
  if (explicit) return explicit;
  if (derived) return derived;
  if (isProduction) {
    throw new Error(
      `[env] ${key} (ou AUTHENTIK_URL + AUTHENTIK_APP_SLUG) is required in production`,
    );
  }
  return devFallback;
};

export const env = {
  port: Number(process.env["PORT"] ?? 3000),
  host: process.env["SERVER_HOST"] ?? "0.0.0.0",
  isProduction,

  db: {
    host: requireInProd("DB_HOST", "localhost"),
    port: Number(process.env["DB_PORT"] ?? 5432),
    user: requireInProd("DB_USER", "postgres"),
    password: requireInProd("DB_PASSWORD", "postgres"),
    database: process.env["DB_NAME"] ?? "people",
  },

  auth: {
    // Authentik OIDC (ADR-027). Migrado de Zitadel — provisionamento e
    // validacao de token agora apontam para o MESMO IdP (sem split-brain).
    issuer: resolveOidc(
      "OIDC_ISSUER",
      derivedIssuer,
      "https://auth.acdg-bv.org.br/application/o/people-context/",
    ),
    jwksUrl: resolveOidc(
      "JWKS_URL",
      derivedJwks,
      "https://auth.acdg-bv.org.br/application/o/people-context/jwks/",
    ),
    // Validacao de audience opcional (claim `aud`). Quando setado, o token
    // precisa ter sido emitido para este client_id. Hardening recomendado.
    audience: process.env["OIDC_AUDIENCE"] || undefined,
    // Introspection RFC 7662 — fallback para access tokens opacos de service
    // accounts (Authentik expoe em <issuer>introspect/). Opcional.
    introspectUrl:
      process.env["OIDC_INTROSPECT_URL"] ??
      (derivedIssuer ? `${derivedIssuer}introspect/` : undefined),
    introspectClientId: process.env["OIDC_INTROSPECT_CLIENT_ID"],
    introspectClientSecret: process.env["OIDC_INTROSPECT_CLIENT_SECRET"],
    allowedServiceAccounts:
      process.env["ALLOWED_SERVICE_ACCOUNTS"]
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? [],
    introspectTimeoutMs: Number(process.env["INTROSPECT_TIMEOUT_MS"] ?? 5000),
    // Claim que carrega os grupos do usuario no token Authentik (array de
    // nomes). Os grupos sao homonimos a `system:role` (ADR-029) + `superadmin`.
    rolesClaim: process.env["OIDC_ROLES_CLAIM"] ?? "groups",
  },

  nats: {
    url: process.env["NATS_URL"],
  },

  // IdP: Authentik (ADR-027).
  // AppSec HIGH-10: validacao consistente — ambos OU nenhum.
  authentik: {
    baseUrl: process.env["AUTHENTIK_URL"],
    token: process.env["AUTHENTIK_TOKEN"],
  },
} as const;

// AppSec HIGH-10: validacao de coerencia das envs do IdP no boot.
// Falha cedo (fail-fast) se config for parcial — evita degradacao silenciosa
// onde createUser silenciosamente nao chama Authentik por causa de noop client.
const { baseUrl: authentikUrl, token: authentikToken } = env.authentik;
const authentikConfigured = authentikUrl !== undefined && authentikToken !== undefined;
const authentikPartial =
  !authentikConfigured && (authentikUrl !== undefined || authentikToken !== undefined);

if (authentikPartial) {
  const missing = authentikUrl === undefined ? "AUTHENTIK_URL" : "AUTHENTIK_TOKEN";
  throw new Error(
    `[env] Authentik config invalida — ${missing} ausente. ` +
      `Defina AMBOS AUTHENTIK_URL e AUTHENTIK_TOKEN, ou NENHUM (para modo noop em dev).`,
  );
}

if (isProduction && !authentikConfigured) {
  throw new Error("[env] AUTHENTIK_URL + AUTHENTIK_TOKEN sao obrigatorios em producao.");
}
