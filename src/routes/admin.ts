import { Elysia } from "elysia";
import type { PersonRepository } from "../repository/person-repository.ts";
import type { AuthGuard } from "../middleware/auth.ts";
import type { AuthentikClient } from "../idp/index.ts";
import { reconcileIdpState, type ReconcilablePerson } from "../application/index.ts";

const timestamp = () => new Date().toISOString();

const isSuperAdmin = (roles: readonly string[]): boolean => roles.some((r) => r === "superadmin");

interface AdminRouteDeps {
  readonly people: PersonRepository;
  readonly guard: AuthGuard;
  readonly idp: AuthentikClient;
}

export const createAdminRoutes = ({ people, guard, idp }: AdminRouteDeps) =>
  new Elysia({ prefix: "/api/v1/admin" })
    // ─── Reconciliacao IdP <-> DB (sob demanda) ───────────────────
    // Re-aplica o estado de ativacao do DB (fonte de verdade) no Authentik
    // para todas as pessoas com login. Cobre a divergencia que a ordem
    // IdP-first sem rollback pode deixar (AppSec HIGH-5). Operacao de
    // manutencao → restrita a superadmin. Pode ser disparada por cron externo.
    .post("/reconcile-idp", async ({ headers, set }) => {
      const auth = await guard(headers, ["admin"]);
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
        if (p.idpUserPk !== null) {
          reconcilable.push({ id: p.id, idpUserPk: p.idpUserPk, active: p.active });
        }
      }

      const report = await reconcileIdpState(idp, reconcilable);
      return { data: report, meta: { timestamp: timestamp() } };
    });
