// Contrato de autorizacao entre ESTE servico e as policies do Cerbos.
//
// Por que existe: o Cerbos e *default deny*. Pedir um recurso ou uma acao que a policy nao
// declara nao devolve erro — devolve EFFECT_DENY, indistinguivel de "sem permissao". Em
// 2026-08-08 isso derrubou producao: as 16 rotas pediam `resource: "person"` (a policy chama de
// `people`) e TODAS respondiam 403 AUTH-002, inclusive para superadmin — o bypass e um derived
// role avaliado dentro de cada resourcePolicy, e sem policy nao ha regra que o ative.
//
// Nenhuma suite pegava isso: `auth.test.ts` usa um Cerbos FAKE, entao passa verde com o wiring
// errado. Este arquivo e o que faltava. Mesmo papel de
// `svc-social-care:Tests/.../CerbosGuardTests.swift`.
//
// ⚠️ As listas abaixo sao um ESPELHO MANUAL das policies versionadas em
// `infra:stack/cells/idp/config/cerbos/policies/people-context/{people,role}.yaml` — a infra e
// outro repositorio, nao da para ler o YAML daqui. Mudou a policy, muda aqui, no mesmo PR.
import { describe, it, expect } from "bun:test";
import {
  PeopleAction,
  PolicyResource,
  REQUESTED_ACTIONS,
  RoleAction,
} from "../../src/middleware/policy-actions.ts";

// ─── Espelho das policies ───────────────────────────────────────

// people.yaml
const POLICY_PEOPLE_ACTIONS: ReadonlySet<string> = new Set([
  "list",
  "get",
  "roles-list",
  "create",
  "update",
  "login",
  "deactivate",
  "reactivate",
  "password-reset",
  "delete",
  "reconcile",
]);

// role.yaml
const POLICY_ROLE_ACTIONS: ReadonlySet<string> = new Set(["assign", "deactivate", "reactivate"]);

const POLICY: Readonly<Record<string, ReadonlySet<string>>> = {
  people: POLICY_PEOPLE_ACTIONS,
  role: POLICY_ROLE_ACTIONS,
};

describe("Cerbos — contrato de recursos e acoes com a policy", () => {
  it("todo recurso que o servico pede tem policy", () => {
    const orfaos = Object.keys(REQUESTED_ACTIONS).filter((r) => POLICY[r] === undefined);
    expect(orfaos).toEqual([]);
  });

  it("toda acao de `people` que o servico pede existe na policy", () => {
    const pedidas = REQUESTED_ACTIONS[PolicyResource.people];
    const orfas = pedidas.filter((a) => !POLICY_PEOPLE_ACTIONS.has(a));
    // Acao sem regra na policy = EFFECT_DENY (default deny) — a rota inteira cai.
    expect(orfas).toEqual([]);
  });

  it("toda acao de `role` que o servico pede existe na policy", () => {
    const pedidas = REQUESTED_ACTIONS[PolicyResource.role];
    const orfas = pedidas.filter((a) => !POLICY_ROLE_ACTIONS.has(a));
    expect(orfas).toEqual([]);
  });

  it("o vocabulario ANTIGO nao volta (regressao de 2026-08-08)", () => {
    // `person` nunca foi um recurso do Cerbos, e estas quatro acoes nunca existiram
    // em policy nenhuma. Se reaparecerem, o servico volta a negar tudo em silencio.
    const nomesQueNaoExistem = ["person", "read", "erase", "enable-login", "assign-role"];
    const usados = [
      ...Object.keys(REQUESTED_ACTIONS),
      ...Object.values(REQUESTED_ACTIONS).flatMap((a) => [...a]),
    ];
    for (const proibido of nomesQueNaoExistem) {
      expect(usados).not.toContain(proibido);
    }
  });

  it("as constantes carregam o valor que vai no payload, nao o nome da chave", () => {
    // camelCase no codigo, kebab-case no PDP — trocar um pelo outro seria DENY silencioso.
    expect(PeopleAction.rolesList).toBe("roles-list");
    expect(PeopleAction.passwordReset).toBe("password-reset");
    expect(RoleAction.assign).toBe("assign");
    expect(PolicyResource.people).toBe("people");
  });
});
