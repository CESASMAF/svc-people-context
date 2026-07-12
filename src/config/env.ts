import { readFileSync } from "node:fs";

// ─── Raw env reading ───────────────────────────────────────────

const isProduction = process.env["NODE_ENV"] === "production";

const requireInProd = (key: string, fallback: string): string => {
  const value = process.env[key];
  if (value !== undefined && value !== "") return value;
  if (isProduction) throw new Error(`[env] ${key} is required in production`);
  return fallback;
};

// ─── Secret reading: arquivo (`<KEY>_FILE`) com fallback no env (`<KEY>`) ──────
//
// POR QUÊ: secrets (senha do banco, token do IdP) NÃO devem vir de variável de
// ambiente — env aparece em `docker inspect`, em /proc/<pid>/environ e pode vazar
// em log. O padrão das imagens oficiais (postgres etc.) é o sufixo `_FILE`: o
// segredo é montado num arquivo (Docker secrets / OpenBao → /run/secrets) e o app
// lê DE LÁ — tmpfs/memória, nunca no env.
//
// Bun NÃO tem suporte nativo a `_FILE` nem a Docker secrets (o `Bun.secrets` é o
// keychain do SO — libsecret/Keychain —, inútil em container distroless). Logo,
// lemos o arquivo nós mesmos. `readFileSync` é intencional: este módulo é avaliado
// no import (boot), antes de qualquer requisição. Mantém o env como FALLBACK.

/** Lê `<KEY>_FILE` (arquivo) se setado; senão o env `<KEY>`. `undefined` se nenhum. */
const fromFileOrEnv = (key: string): string | undefined => {
  const file = process.env[`${key}_FILE`];
  if (file !== undefined && file !== "") return readFileSync(file, "utf8").trim();
  const value = process.env[key];
  return value !== undefined && value !== "" ? value : undefined;
};

/** Como `requireInProd`, mas aceita o secret via `<KEY>_FILE` (preferido). */
const requireSecretInProd = (key: string, fallback: string): string => {
  const value = fromFileOrEnv(key);
  if (value !== undefined) return value;
  if (isProduction) throw new Error(`[env] ${key} (ou ${key}_FILE) is required in production`);
  return fallback;
};

// ─── OIDC issuer/JWKS — IdP: Ory Hydra ─────────────────────────
//
// Com Ory o issuer é o Hydra (auth.<domain>, SEM path de slug); o JWKS é buscado
// internamente na malha (http://hydra:4444/.well-known/jwks.json). OIDC_ISSUER e
// JWKS_URL vêm explícitos do compose (derivados de DOMAIN).

const resolveOidc = (key: string, devFallback: string): string => {
  const explicit = process.env[key];
  if (explicit !== undefined && explicit !== "") return explicit;
  if (isProduction) {
    throw new Error(`[env] ${key} é obrigatório em produção (IdP Ory)`);
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
    password: requireSecretInProd("DB_PASSWORD", "postgres"), // aceita DB_PASSWORD_FILE (/run/secrets)
    database: process.env["DB_NAME"] ?? "people",
  },

  auth: {
    // OIDC do Ory Hydra. issuer = auth.<domain> (o `iss` do token); o JWKS é
    // buscado interno na malha. Ambos vêm explícitos do compose (derivados de DOMAIN).
    issuer: resolveOidc("OIDC_ISSUER", "https://auth.cesasmaf.app.br"),
    jwksUrl: resolveOidc("JWKS_URL", "http://localhost:4444/.well-known/jwks.json"),
    // Validacao de audience opcional (claim `aud`). Quando setado, o token
    // precisa ter sido emitido para este client_id (= acdg-web). Recomendado.
    // Empty string → undefined (audience opcional; "" não é audience válida).
    audience: process.env["OIDC_AUDIENCE"] !== "" ? process.env["OIDC_AUDIENCE"] : undefined,
    // Introspection RFC 7662 — fallback opcional p/ tokens opacos. Com Hydra os
    // access tokens são JWT (strategy jwt), então a validação por JWKS basta; só
    // ativa se OIDC_INTROSPECT_URL for setado (ex.: Hydra Admin /admin/oauth2/introspect).
    introspectUrl: process.env["OIDC_INTROSPECT_URL"],
    introspectClientId: process.env["OIDC_INTROSPECT_CLIENT_ID"],
    introspectClientSecret: process.env["OIDC_INTROSPECT_CLIENT_SECRET"],
    allowedServiceAccounts:
      process.env["ALLOWED_SERVICE_ACCOUNTS"]
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? [],
    introspectTimeoutMs: Number(process.env["INTROSPECT_TIMEOUT_MS"] ?? 5000),
    // Claim que carrega os grupos do usuario no token (array de nomes). Os grupos
    // sao homonimos a `<system>:role` (ADR-029) + `superadmin`, injetados pela
    // consent-bridge do Ory. Mantém-se `groups`.
    rolesClaim: process.env["OIDC_ROLES_CLAIM"] ?? "groups",
  },

  nats: {
    url: process.env["NATS_URL"],
  },

  // Cerbos (PDP) — RBAC versionado/auditável (defense-in-depth com o guard local).
  // Sem CERBOS_URL, o guard usa só o check de role local.
  cerbos: {
    url: process.env["CERBOS_URL"],
  },

  // IdP: Ory Kratos (Admin API). Provisionamento via Kratos Admin (interna, sem
  // token Bearer — a proteção é isolação de rede). `token` opcional só se um proxy
  // com Bearer for posto na frente do Admin (defesa-em-profundidade — follow-up).
  ory: {
    kratosAdminUrl: process.env["KRATOS_ADMIN_URL"],
    kratosAdminToken: fromFileOrEnv("KRATOS_ADMIN_TOKEN"), // aceita KRATOS_ADMIN_TOKEN_FILE
  },
} as const;

// Fail-fast em produção: o provisionamento de identidades precisa do Kratos Admin.
// Sem ele, o app cai no cliente noop (provisioning desabilitado) — inaceitável em prod.
if (isProduction && env.ory.kratosAdminUrl === undefined) {
  throw new Error("[env] KRATOS_ADMIN_URL é obrigatório em produção (provisionamento IdP).");
}
