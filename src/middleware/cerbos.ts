// Cliente do Cerbos (PDP — Policy Decision Point).
//
// Externaliza a decisão de RBAC (hoje no createAuthGuard) para políticas
// versionadas e auditáveis (cells/idp/config/cerbos/policies). O `principal.roles`
// são os grupos do JWT (`<system>:<role>` + `superadmin`), então a decisão do
// Cerbos ESPELHA o suffix-match/bypass do guard, agora com decision logs.
//
// Desenho (defense-in-depth): consultado DEPOIS do check de role local — a decisão
// é a mesma; o Cerbos adiciona trilha de auditoria e uma 2a verificação. Fail-open:
// `check` devolve `null` quando o Cerbos está indisponível/erro → o caller defere ao
// resultado do guard local (sem outage). try/catch só no boundary (ADR-014).

// Uma consulta ao PDP. Objeto e não posicional: são 5 campos e trocar `resource` por
// `action` na chamada compila e vira DENY silencioso.
export type CerbosCheck = Readonly<{
  roles: readonly string[];
  resource: string;
  action: string;
  principalId: string;
  // Vira `resource.attr` no payload. A policy `role.yaml` decide POR ATRIBUTO
  // (`R.attr.system`, `R.attr.targetRole`, `R.attr.targetUserId`); omiti-los não é
  // "sem restrição extra", é DENY — a condição não tem como ser avaliada.
  attr?: Readonly<Record<string, string>>;
}>;

export interface CerbosClient {
  // `true`/`false` = decisão; `null` = indeterminado (Cerbos off/erro).
  readonly check: (input: CerbosCheck) => Promise<boolean | null>;
}

export const createCerbosClient = (baseUrl: string): CerbosClient => ({
  check: async ({ roles, resource, action, principalId, attr }) => {
    try {
      const response = await fetch(`${baseUrl}/api/check/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          principal: {
            id: principalId !== "" ? principalId : "anonymous",
            roles: [...roles].sort(),
          },
          resources: [
            {
              resource: {
                kind: resource,
                id: "*",
                policyVersion: "default",
                ...(attr !== undefined ? { attr } : {}),
              },
              actions: [action],
            },
          ],
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        results?: readonly { actions?: Record<string, string> }[];
      };
      const effect = data.results?.[0]?.actions?.[action];
      return effect === undefined ? null : effect === "EFFECT_ALLOW";
    } catch {
      return null;
    }
  },
});

// Cliente noop (Cerbos desligado / testes): sempre indeterminado → defere ao guard.
export const createNoopCerbosClient = (): CerbosClient => ({
  check: async () => null,
});
