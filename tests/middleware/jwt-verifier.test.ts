import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";

// ─── Configura o env ANTES de importar jwt.ts/env.ts ────────────
//
// jwt.ts e env.ts nao sao carregados por nenhum outro teste (rotas usam
// fake-idp), entao o import dinamico abaixo avalia env.ts com ESTAS vars.
// IdP = Ory Hydra: issuer = auth.<domain> (sem path de slug), JWKS explicito.
process.env["NODE_ENV"] = "test";
process.env["OIDC_ISSUER"] = "https://auth.test";
process.env["JWKS_URL"] = "https://auth.test/.well-known/jwks.json";
process.env["OIDC_AUDIENCE"] = "people-context-client";
process.env["OIDC_ROLES_CLAIM"] = "groups";
process.env["ALLOWED_SERVICE_ACCOUNTS"] = "svc-sub-1";
process.env["OIDC_INTROSPECT_URL"] = "https://auth.test/introspect/";
process.env["OIDC_INTROSPECT_CLIENT_ID"] = "introspect-client";
process.env["OIDC_INTROSPECT_CLIENT_SECRET"] = "introspect-secret";

const ISSUER = "https://auth.test";
const AUDIENCE = "people-context-client";
const KID = "test-key-1";

// Carregados dinamicamente apos o env estar pronto.
let createJwtVerifier: (typeof import("../../src/middleware/jwt.ts"))["createJwtVerifier"];
let validateJwks: (typeof import("../../src/middleware/jwt.ts"))["validateJwks"];

let privateKey: CryptoKey;
let publicJwk: JWK;

// ─── Mock de fetch roteado (JWKS + introspection) ───────────────

const okJwks = (): Response =>
  new Response(JSON.stringify({ keys: [publicJwk] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let jwksResponder: () => Response = okJwks;
let introspectResponder: () => Response = () =>
  new Response(JSON.stringify({ active: true, groups: ["social-care:worker"] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let originalFetch: typeof globalThis.fetch;

const makeToken = async (opts: {
  sub?: string;
  groups?: unknown;
  issuer?: string;
  audience?: string;
}): Promise<string> => {
  const payload: Record<string, unknown> = {};
  if (opts.groups !== undefined) payload["groups"] = opts.groups;
  const builder = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m");
  if (opts.sub !== undefined) builder.setSubject(opts.sub);
  return builder.sign(privateKey);
};

beforeAll(async () => {
  const { publicKey, privateKey: pk } = await generateKeyPair("RS256");
  privateKey = pk;
  publicJwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };

  const mod = await import("../../src/middleware/jwt.ts");
  createJwtVerifier = mod.createJwtVerifier;
  validateJwks = mod.validateJwks;

  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("jwks")) return jwksResponder();
    if (url.includes("/introspect/")) return introspectResponder();
    throw new Error(`fetch inesperado no teste: ${url}`);
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  jwksResponder = okJwks;
  introspectResponder = () =>
    new Response(JSON.stringify({ active: true, groups: ["social-care:worker"] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
});

// ─── createJwtVerifier ──────────────────────────────────────────

describe("createJwtVerifier (Ory Hydra OIDC, RS256 real)", () => {
  it("extrai roles do claim `groups` de um token valido", async () => {
    const verify = createJwtVerifier();
    const token = await makeToken({
      sub: "uid-hex-1",
      groups: ["social-care:admin", "superadmin"],
    });

    const ctx = await verify(token);
    expect(ctx).not.toBeNull();
    expect(ctx?.sub).toBe("uid-hex-1");
    expect(ctx?.roles).toEqual(["social-care:admin", "superadmin"]);
  });

  it("retorna roles vazio quando o token nao tem claim groups", async () => {
    const verify = createJwtVerifier();
    const token = await makeToken({ sub: "uid-hex-2" });

    const ctx = await verify(token);
    expect(ctx?.roles).toEqual([]);
  });

  it("ignora groups que nao sejam array de strings (defensivo)", async () => {
    const verify = createJwtVerifier();
    const token = await makeToken({ sub: "uid-hex-3", groups: "social-care:admin" });

    const ctx = await verify(token);
    expect(ctx?.roles).toEqual([]);
  });

  it("filtra elementos nao-string dentro de groups", async () => {
    const verify = createJwtVerifier();
    const token = await makeToken({ sub: "uid-hex-3b", groups: ["social-care:admin", 42, null] });

    const ctx = await verify(token);
    expect(ctx?.roles).toEqual(["social-care:admin"]);
  });

  it("retorna null quando o issuer nao confere", async () => {
    const verify = createJwtVerifier();
    const token = await makeToken({ sub: "x", groups: [], issuer: "https://evil.example/" });

    expect(await verify(token)).toBeNull();
  });

  it("retorna null quando a audience nao confere", async () => {
    const verify = createJwtVerifier();
    const token = await makeToken({ sub: "x", groups: [], audience: "outro-client" });

    expect(await verify(token)).toBeNull();
  });

  it("retorna null para token malformado / assinatura invalida", async () => {
    const verify = createJwtVerifier();
    expect(await verify("nao.e.um.jwt")).toBeNull();
  });

  it("retorna null quando o token nao tem sub", async () => {
    const verify = createJwtVerifier();
    const token = await makeToken({ groups: ["social-care:admin"] }); // sem setSubject

    expect(await verify(token)).toBeNull();
  });

  // ── Introspection fallback (service accounts) ──────────────────

  it("usa introspection quando service account vem sem groups no token", async () => {
    introspectResponder = () =>
      new Response(JSON.stringify({ active: true, groups: ["queue-manager:worker"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const verify = createJwtVerifier();
    const token = await makeToken({ sub: "svc-sub-1" }); // sub na allowlist, sem groups

    const ctx = await verify(token);
    expect(ctx?.roles).toEqual(["queue-manager:worker"]);
  });

  it("introspection inativa (active:false) → roles vazio", async () => {
    introspectResponder = () =>
      new Response(JSON.stringify({ active: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const verify = createJwtVerifier();
    const token = await makeToken({ sub: "svc-sub-1" });

    const ctx = await verify(token);
    expect(ctx?.roles).toEqual([]);
  });

  it("introspection com HTTP error → roles vazio (nao quebra)", async () => {
    introspectResponder = () =>
      new Response(JSON.stringify({ detail: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    const verify = createJwtVerifier();
    const token = await makeToken({ sub: "svc-sub-1" });

    const ctx = await verify(token);
    expect(ctx?.roles).toEqual([]);
  });

  it("introspection com erro de rede → roles vazio (catch)", async () => {
    introspectResponder = () => {
      throw new Error("ECONNREFUSED");
    };
    const verify = createJwtVerifier();
    const token = await makeToken({ sub: "svc-sub-1" });

    const ctx = await verify(token);
    expect(ctx?.roles).toEqual([]);
  });

  it("nao chama introspection para sub fora da allowlist", async () => {
    introspectResponder = () => {
      throw new Error("nao deveria ser chamado");
    };
    const verify = createJwtVerifier();
    const token = await makeToken({ sub: "uid-normal" }); // sem groups, fora da allowlist

    const ctx = await verify(token);
    expect(ctx?.roles).toEqual([]);
  });
});

// ─── validateJwks ───────────────────────────────────────────────

describe("validateJwks", () => {
  it("passa quando o endpoint retorna keys", async () => {
    jwksResponder = okJwks;
    await validateJwks(); // nao deve lancar
  });

  it("nao lanca em non-production quando o JWKS falha (warn)", async () => {
    jwksResponder = () => new Response("error", { status: 500 });
    await validateJwks(); // non-prod: apenas warning
  });

  it("nao lanca em non-production quando o JWKS vem sem keys", async () => {
    jwksResponder = () =>
      new Response(JSON.stringify({ keys: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await validateJwks();
  });
});
