import type { AuthGuard, AuthResult, AuthzCheck } from "../../src/middleware/auth.ts";

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

// PDP de 2a fase que sempre defere (= Cerbos off/indeterminado). Espelha o comportamento real
// quando CERBOS_URL nao esta setado: quem decide e o guard local + as regras da rota.
export const createDeferringAuthzCheck = (): AuthzCheck => async () => null;

// PDP que sempre nega — para exercitar a rota quando a policy reprova. Registra as chamadas
// para o teste conferir os ATRIBUTOS enviados (system/targetRole/targetUserId), que sao o que
// `role.yaml` le e o que faltava no wiring original.
export const createDenyingAuthzCheck = (): {
  readonly check: AuthzCheck;
  readonly calls: unknown[];
} => {
  const calls: unknown[] = [];
  return {
    calls,
    check: async (auth, resource, action, attr) => {
      calls.push({ sub: auth.sub, roles: auth.roles, resource, action, attr });
      return {
        kind: "forbidden",
        status: 403,
        response: {
          success: false,
          error: { code: "AUTH-002", message: `Cerbos negou ${action} em ${resource}` },
        },
      };
    },
  };
};

// PDP que defere mas REGISTRA as chamadas — para conferir os atributos sem barrar a rota.
export const createRecordingAuthzCheck = (): {
  readonly check: AuthzCheck;
  readonly calls: { resource: string; action: string; attr: Record<string, string> }[];
} => {
  const calls: { resource: string; action: string; attr: Record<string, string> }[] = [];
  return {
    calls,
    check: async (_auth, resource, action, attr) => {
      calls.push({ resource, action, attr: { ...attr } });
      return null;
    },
  };
};
