import { Elysia, t } from "elysia";
import type { PersonRepository } from "../repository/person-repository.ts";
import type { RoleRepository } from "../repository/role-repository.ts";
import type { AuthGuard } from "../middleware/auth.ts";
import type { EventPublisher } from "../events/publisher.ts";
import type { IdpClient } from "../idp/index.ts";
import { events } from "../events/publisher.ts";
import { validateAssignRole } from "../domain/index.ts";
import { syncRoleAssignment, syncRoleRemoval } from "../application/index.ts";

const timestamp = () => new Date().toISOString();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isSuperAdmin = (roles: readonly string[]): boolean => roles.some((r) => r === "superadmin");

// Extrai sistemas onde o caller tem "admin" — ex: ["social-care:admin"] -> ["social-care"]
const adminSystems = (roles: readonly string[]): readonly string[] =>
  roles.filter((r) => r.endsWith(":admin")).map((r) => r.slice(0, r.lastIndexOf(":")));

interface RolesRouteDeps {
  readonly people: PersonRepository;
  readonly roles: RoleRepository;
  readonly guard: AuthGuard;
  readonly publisher: EventPublisher;
  readonly idp: IdpClient;
}

export const createRolesRoutes = ({ people, roles, guard, publisher, idp }: RolesRouteDeps) =>
  new Elysia({ prefix: "/api/v1" })
    .post(
      "/people/:personId/roles",
      async ({ params, body, headers, set }) => {
        const auth = await guard(headers, ["admin"], true, {
          resource: "person",
          action: "assign-role",
        });
        if (auth.kind !== "ok") {
          set.status = auth.status;
          return auth.response;
        }

        if (!UUID_RE.test(params.personId)) {
          set.status = 400;
          return {
            success: false,
            error: { code: "PEO-003", message: "personId must be a valid UUID" },
          };
        }

        const validation = validateAssignRole(body);
        if (validation.kind === "error") {
          set.status = 400;
          return { success: false, error: { code: "ROL-001", message: validation.message } };
        }

        const callerRoles = auth.auth.roles;
        const callerIsSuperAdmin = isSuperAdmin(callerRoles);

        // Rule 1: only superadmin can assign "superadmin"
        if (body.role === "superadmin" && !callerIsSuperAdmin) {
          set.status = 403;
          return {
            success: false,
            error: { code: "ROL-006", message: "Only superadmin can assign superadmin role" },
          };
        }

        // Rule 2: admin pode atribuir roles apenas dentro dos seus proprios sistemas
        if (!callerIsSuperAdmin) {
          const allowed = adminSystems(callerRoles);
          if (!allowed.includes(body.system)) {
            set.status = 403;
            return {
              success: false,
              error: {
                code: "ROL-007",
                message: `Not authorized to assign roles in system '${body.system}'`,
              },
            };
          }
        }

        const person = await people.findById(params.personId);
        if (person === null) {
          set.status = 404;
          return { success: false, error: { code: "PEO-002", message: "Person not found" } };
        }

        // Rule 3: prevent self-assignment (matching uid no JWT vs uid persistido na pessoa)
        if (!callerIsSuperAdmin && person.idpUserId === auth.auth.sub) {
          set.status = 403;
          return {
            success: false,
            error: { code: "ROL-008", message: "Cannot assign roles to yourself" },
          };
        }

        const { role, created } = await roles.assign(params.personId, body);
        if (!created) {
          set.status = 204;
          return;
        }

        await publisher.publish(
          events.roleAssigned(auth.actorId, {
            personId: params.personId,
            system: body.system,
            role: body.role,
          }),
        );

        // Sincroniza role com Authentik se pessoa tem login.
        if (person.idpUserId !== null) {
          await syncRoleAssignment(idp, {
            system: body.system,
            role: body.role,
            idpUserId: person.idpUserId,
            personId: params.personId,
          });
        }

        set.status = 201;
        return { data: { id: role.id }, meta: { timestamp: timestamp() } };
      },
      {
        body: t.Object({
          system: t.String({ minLength: 1 }),
          role: t.String({ minLength: 1 }),
        }),
      },
    )

    .get("/people/:personId/roles", async ({ headers, params, query, set }) => {
      const auth = await guard(headers, ["worker", "owner", "admin"], false, {
        resource: "person",
        action: "read",
      }); // GET: actorId do JWT.sub
      if (auth.kind !== "ok") {
        set.status = auth.status;
        return auth.response;
      }

      if (!UUID_RE.test(params.personId)) {
        set.status = 400;
        return {
          success: false,
          error: { code: "PEO-003", message: "personId must be a valid UUID" },
        };
      }

      const person = await people.findById(params.personId);
      if (person === null) {
        set.status = 404;
        return { success: false, error: { code: "PEO-002", message: "Person not found" } };
      }

      const active = query["active"] !== undefined ? query["active"] === "true" : undefined;
      const result = await roles.listByPerson(params.personId, active);
      return { data: result, meta: { timestamp: timestamp() } };
    })

    .put("/people/:personId/roles/:roleId/deactivate", async ({ params, headers, set }) => {
      const auth = await guard(headers, ["admin"], true, {
        resource: "person",
        action: "remove-role",
      });
      if (auth.kind !== "ok") {
        set.status = auth.status;
        return auth.response;
      }

      if (!UUID_RE.test(params.personId) || !UUID_RE.test(params.roleId)) {
        set.status = 400;
        return {
          success: false,
          error: { code: "ROL-005", message: "personId and roleId must be valid UUIDs" },
        };
      }

      // Code-review HIGH-1: auth check ANTES da mutacao (sem rollback compensatorio).
      const existingRole = await roles.findById(params.personId, params.roleId);
      if (existingRole?.active !== true) {
        set.status = 404;
        return { success: false, error: { code: "ROL-002", message: "Active role not found" } };
      }
      if (
        !isSuperAdmin(auth.auth.roles) &&
        !adminSystems(auth.auth.roles).includes(existingRole.system)
      ) {
        set.status = 403;
        return {
          success: false,
          error: {
            code: "ROL-007",
            message: `Not authorized to manage roles in system '${existingRole.system}'`,
          },
        };
      }

      const person = await people.findById(params.personId);
      const deactivated = await roles.deactivate(params.personId, params.roleId);
      if (deactivated === null) {
        // Race: foi desativada por outra request entre findById e deactivate.
        set.status = 409;
        return {
          success: false,
          error: { code: "ROL-009", message: "Role state changed during request" },
        };
      }

      await publisher.publish(
        events.roleDeactivated(auth.actorId, {
          personId: params.personId,
          system: deactivated.system,
          role: deactivated.role,
        }),
      );

      // Remove user do group correspondente no Authentik
      if (person?.idpUserId != null) {
        await syncRoleRemoval(idp, {
          system: deactivated.system,
          role: deactivated.role,
          idpUserId: person.idpUserId,
          personId: params.personId,
        });
      }

      set.status = 204;
    })

    .put("/people/:personId/roles/:roleId/reactivate", async ({ params, headers, set }) => {
      const auth = await guard(headers, ["admin"], true, {
        resource: "person",
        action: "assign-role",
      });
      if (auth.kind !== "ok") {
        set.status = auth.status;
        return auth.response;
      }

      if (!UUID_RE.test(params.personId) || !UUID_RE.test(params.roleId)) {
        set.status = 400;
        return {
          success: false,
          error: { code: "ROL-005", message: "personId and roleId must be valid UUIDs" },
        };
      }

      // Code-review HIGH-1: auth check ANTES da mutacao.
      const existingRole = await roles.findById(params.personId, params.roleId);
      if (existingRole === null || existingRole.active) {
        set.status = 404;
        return { success: false, error: { code: "ROL-003", message: "Inactive role not found" } };
      }
      if (
        !isSuperAdmin(auth.auth.roles) &&
        !adminSystems(auth.auth.roles).includes(existingRole.system)
      ) {
        set.status = 403;
        return {
          success: false,
          error: {
            code: "ROL-007",
            message: `Not authorized to manage roles in system '${existingRole.system}'`,
          },
        };
      }

      const person = await people.findById(params.personId);
      const reactivated = await roles.reactivate(params.personId, params.roleId);
      if (reactivated === null) {
        set.status = 409;
        return {
          success: false,
          error: { code: "ROL-009", message: "Role state changed during request" },
        };
      }

      await publisher.publish(
        events.roleReactivated(auth.actorId, {
          personId: params.personId,
          system: reactivated.system,
          role: reactivated.role,
        }),
      );

      // Re-adicionar ao group correspondente no Authentik
      if (person?.idpUserId != null) {
        await syncRoleAssignment(idp, {
          system: reactivated.system,
          role: reactivated.role,
          idpUserId: person.idpUserId,
          personId: params.personId,
        });
      }

      set.status = 204;
    })

    .get("/roles", async ({ headers, query, set }) => {
      const auth = await guard(headers, ["worker", "owner", "admin"], false, {
        resource: "person",
        action: "read",
      }); // GET: actorId do JWT.sub
      if (auth.kind !== "ok") {
        set.status = auth.status;
        return auth.response;
      }

      const system = query["system"];
      if (system === undefined || system === "") {
        set.status = 400;
        return {
          success: false,
          error: { code: "ROL-004", message: "system query parameter is required" },
        };
      }

      const role = query["role"] ?? undefined;
      const active = query["active"] !== "false";
      const results = await roles.query(system, role, active);
      return { data: results, meta: { timestamp: timestamp() } };
    });
