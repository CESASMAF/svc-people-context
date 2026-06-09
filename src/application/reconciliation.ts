// Application layer — reconciliacao de estado IdP <-> DB.
//
// Materializa o "detectavel por reconciliacao" citado nas rotas de
// (de)ativacao (AppSec HIGH-5): a ordem IdP-first sem rollback compensatorio
// pode deixar DB e Authentik divergentes se o 2o passo falhar. Esta funcao
// varre as pessoas com login e re-aplica o estado do DB (fonte de verdade)
// no IdP. Funcao PURA: recebe a lista ja carregada do repository.

import type { AuthentikClient } from "../idp/index.ts";

export interface ReconcilablePerson {
  readonly id: string;
  readonly idpUserPk: number;
  readonly active: boolean;
}

export interface ReconciliationFix {
  readonly personId: string;
  readonly idpUserPk: number;
  readonly from: boolean; // is_active no IdP antes da correcao
  readonly to: boolean; // estado correto, conforme o DB
}

export interface ReconciliationError {
  readonly personId: string;
  readonly idpUserPk: number;
  readonly stage: "fetch" | "apply";
  readonly code: number;
}

export interface ReconciliationReport {
  readonly checked: number;
  readonly inSync: number;
  readonly fixed: readonly ReconciliationFix[];
  readonly errors: readonly ReconciliationError[];
}

export const reconcileIdpState = async (
  idp: AuthentikClient,
  people: readonly ReconcilablePerson[],
): Promise<ReconciliationReport> => {
  const fixed: ReconciliationFix[] = [];
  const errors: ReconciliationError[] = [];
  let inSync = 0;

  for (const person of people) {
    const fetched = await idp.getUser(person.idpUserPk);
    if (!fetched.ok) {
      errors.push({
        personId: person.id,
        idpUserPk: person.idpUserPk,
        stage: "fetch",
        code: fetched.code,
      });
      continue;
    }

    if (fetched.data.is_active === person.active) {
      inSync++;
      continue;
    }

    // DB e a fonte de verdade — re-aplica o estado correto no IdP.
    const apply = person.active
      ? await idp.reactivateUser(person.idpUserPk)
      : await idp.deactivateUser(person.idpUserPk);
    if (!apply.ok) {
      errors.push({
        personId: person.id,
        idpUserPk: person.idpUserPk,
        stage: "apply",
        code: apply.code,
      });
      continue;
    }

    fixed.push({
      personId: person.id,
      idpUserPk: person.idpUserPk,
      from: fetched.data.is_active,
      to: person.active,
    });
  }

  return { checked: people.length, inSync, fixed, errors };
};
