// Application layer — reconciliacao de estado IdP <-> DB.
//
// Materializa o "detectavel por reconciliacao" citado nas rotas de
// (de)ativacao (AppSec HIGH-5): a ordem IdP-first sem rollback compensatorio
// pode deixar DB e Kratos divergentes se o 2o passo falhar. Esta funcao varre as
// pessoas com login e re-aplica o estado do DB (fonte de verdade) no IdP. Funcao
// PURA: recebe a lista ja carregada do repository.

import type { IdpClient, IdpUserId } from "../idp/index.ts";

export interface ReconcilablePerson {
  readonly id: string;
  readonly idpUserId: IdpUserId;
  readonly active: boolean;
}

export interface ReconciliationFix {
  readonly personId: string;
  readonly idpUserId: IdpUserId;
  readonly from: boolean; // active no IdP antes da correcao
  readonly to: boolean; // estado correto, conforme o DB
}

export interface ReconciliationError {
  readonly personId: string;
  readonly idpUserId: IdpUserId;
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
  idp: IdpClient,
  people: readonly ReconcilablePerson[],
): Promise<ReconciliationReport> => {
  const fixed: ReconciliationFix[] = [];
  const errors: ReconciliationError[] = [];
  let inSync = 0;

  for (const person of people) {
    const fetched = await idp.getUser(person.idpUserId);
    if (!fetched.ok) {
      errors.push({
        personId: person.id,
        idpUserId: person.idpUserId,
        stage: "fetch",
        code: fetched.code,
      });
      continue;
    }

    if (fetched.data.active === person.active) {
      inSync++;
      continue;
    }

    // DB e a fonte de verdade — re-aplica o estado correto no IdP.
    const apply = person.active
      ? await idp.reactivateUser(person.idpUserId)
      : await idp.deactivateUser(person.idpUserId);
    if (!apply.ok) {
      errors.push({
        personId: person.id,
        idpUserId: person.idpUserId,
        stage: "apply",
        code: apply.code,
      });
      continue;
    }

    fixed.push({
      personId: person.id,
      idpUserId: person.idpUserId,
      from: fetched.data.active,
      to: person.active,
    });
  }

  return { checked: people.length, inSync, fixed, errors };
};
