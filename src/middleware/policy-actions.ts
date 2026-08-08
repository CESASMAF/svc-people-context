/// Vocabulario de autorizacao do PDP — recursos e acoes que este servico pede ao Cerbos.
///
/// **Espelha** as policies versionadas em
/// `infra:stack/cells/idp/config/cerbos/policies/people-context/{people,role}.yaml`.
/// Os dois lados mudam juntos — `tests/middleware/cerbos-contrato.test.ts` falha se divergirem.
///
/// **Por que constantes e nao string solta.** A acao e a chave da decisao do PDP, e o Cerbos e
/// *default deny*: pedir um recurso ou uma acao que a policy nao declara nao e erro, e **negacao
/// silenciosa**. Foi exatamente o que derrubou producao em 2026-08-08 — as 16 rotas pediam
/// `resource: "person"` (nome plausivel, inexistente: a policy chama de `people`) e TODAS
/// respondiam 403 AUTH-002, inclusive para superadmin: o bypass e um derived role avaliado
/// DENTRO de cada resourcePolicy, e sem policy nao ha regra que o ative.
/// String nao e conferida por compilador nem por review; um tipo fechado e.
///
/// O `svc-social-care` ja tinha aprendido isto (`IO/HTTP/Auth/PatientPolicyAction.swift`).

// `enum` e proibido no repo (.claude/rules/functional-ts.md) — union literal via `as const`.

export const PolicyResource = {
  /// Gestao de pessoas/usuarios — `people.yaml`.
  people: "people",
  /// ATRIBUICAO/gestao de papeis — `role.yaml`. Decide por atributos do recurso
  /// (`system`, `targetRole`, `targetUserId`), entao exige `RoleAttr` no check.
  role: "role",
} as const;

export type PolicyResource = (typeof PolicyResource)[keyof typeof PolicyResource];

/// Acoes do recurso `people`.
export const PeopleAction = {
  // Leitura — worker, owner, admin.
  list: "list",
  get: "get",
  rolesList: "roles-list",

  // Escrita cadastral e habilitacao de login — worker e admin.
  create: "create",
  update: "update",
  login: "login",

  // Conta — so admin.
  deactivate: "deactivate",
  reactivate: "reactivate",
  passwordReset: "password-reset",

  // Erasure (LGPD Art. 18 V) — so admin na policy; a rota ainda exige superadmin no corpo.
  delete: "delete",

  // Reconciliacao IdP<->DB (manutencao) — so superadmin.
  reconcile: "reconcile",
} as const;

export type PeopleAction = (typeof PeopleAction)[keyof typeof PeopleAction];

/// Acoes do recurso `role`.
export const RoleAction = {
  assign: "assign",
  deactivate: "deactivate",
  reactivate: "reactivate",
} as const;

export type RoleAction = (typeof RoleAction)[keyof typeof RoleAction];

/// Atributos que `role.yaml` le do recurso (`R.attr.*`). Sem eles a condicao da policy nao tem
/// como ser avaliada e o Cerbos responde DENY — mesmo para um admin legitimo.
///
/// ⚠️ `targetUserId` e o **uid do IdP** da pessoa-alvo (`person.idpUserId`), NAO o `personId`:
/// a condicao compara com `P.id`, que e o `sub` do JWT. E a mesma comparacao que a rota ja faz
/// a mao em ROL-008.
export type RoleAttr = Readonly<{
  system: string;
  targetRole: string;
  targetUserId: string;
}>;

/// Todas as acoes que este servico pede, por recurso. Usado pelo teste de contrato.
export const REQUESTED_ACTIONS: Readonly<Record<PolicyResource, readonly string[]>> = {
  [PolicyResource.people]: Object.values(PeopleAction),
  [PolicyResource.role]: Object.values(RoleAction),
};
