import { Elysia } from "elysia";
import type { PersonRepository } from "../repository/person-repository.ts";
import { hasSuperAdmin, type AuthGuard } from "../middleware/auth.ts";
import { PeopleAction, PolicyResource } from "../middleware/policy-actions.ts";
import type { IdpClient } from "../idp/index.ts";
import { reconcileIdpState, type ReconcilablePerson } from "../application/index.ts";

const timestamp = () => new Date().toISOString();

// Reexportado do guard: o bypass casa `superadmin` bare E `<system>:superadmin`, igual ao
// derived role do Cerbos. Ter uma cópia por arquivo foi como as duas metades divergiram.
const isSuperAdmin = hasSuperAdmin;

interface AdminRouteDeps {
  readonly people: PersonRepository;
  readonly guard: AuthGuard;
  readonly idp: IdpClient;
}

export const createAdminRoutes = ({ people, guard, idp }: AdminRouteDeps) =>
  new Elysia({ prefix: "/api/v1/admin" })
    // ─── Reconciliacao IdP <-> DB (sob demanda) ───────────────────
    // Re-aplica o estado de ativacao do DB (fonte de verdade) no Authentik
    // para todas as pessoas com login. Cobre a divergencia que a ordem
    // IdP-first sem rollback pode deixar (AppSec HIGH-5). Operacao de
    // manutencao → restrita a superadmin. Pode ser disparada por cron externo.
    .post("/reconcile-idp", async ({ headers, set }) => {
      const auth = await guard(headers, ["admin"], true, {
        resource: PolicyResource.people,
        action: PeopleAction.reconcile,
      });
      if (auth.kind !== "ok") {
        set.status = auth.status;
        return auth.response;
      }

      if (!isSuperAdmin(auth.auth.roles)) {
        set.status = 403;
        return {
          success: false,
          error: { code: "ADM-001", message: "Only superadmin can run reconciliation" },
        };
      }

      const persons = await people.listWithIdpUser();
      const reconcilable: ReconcilablePerson[] = [];
      for (const p of persons) {
        if (p.idpUserId !== null) {
          reconcilable.push({ id: p.id, idpUserId: p.idpUserId, active: p.active });
        }
      }

      const report = await reconcileIdpState(idp, reconcilable);
      return { data: report, meta: { timestamp: timestamp() } };
    });
