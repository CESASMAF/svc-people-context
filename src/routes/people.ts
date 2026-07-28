import { Elysia, t } from "elysia";
import type { PersonRepository } from "../repository/person-repository.ts";
import type { AuthGuard } from "../middleware/auth.ts";
import type { EventPublisher } from "../events/publisher.ts";
import type { IdpClient } from "../idp/index.ts";
import { events } from "../events/publisher.ts";
import { validateCreatePerson, validateUpdatePerson } from "../domain/index.ts";
import {
  provisionUserInIdp,
  syncPersonProfileToIdp,
  usernameFromEmail,
} from "../application/index.ts";

const timestamp = () => new Date().toISOString();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CPF_RE = /^\d{11}$/;

const isSuperAdmin = (roles: readonly string[]): boolean => roles.some((r) => r === "superadmin");

interface PeopleRouteDeps {
  readonly people: PersonRepository;
  readonly guard: AuthGuard;
  readonly publisher: EventPublisher;
  readonly idp: IdpClient;
}

export const createPeopleRoutes = ({ people, guard, publisher, idp }: PeopleRouteDeps) =>
  new Elysia({ prefix: "/api/v1" })
    .post(
      "/people",
      async ({ body, headers, set }) => {
        const auth = await guard(headers, ["worker", "admin"], true, {
          resource: "person",
          action: "create",
        });
        if (auth.kind !== "ok") {
          set.status = auth.status;
          return auth.response;
        }

        const validation = validateCreatePerson(body);
        if (validation.kind === "error") {
          set.status = 400;
          return { success: false, error: { code: "PEO-001", message: validation.message } };
        }

        if (body.cpf !== undefined && body.cpf !== "") {
          const existing = await people.findByCpf(body.cpf);
          if (existing !== null) {
            set.status = 201;
            return { data: { id: existing.id }, meta: { timestamp: timestamp() } };
          }
        }

        const person = await people.create(body);

        // AppSec HIGH-8: CPF NAO entra em event payload (LGPD minimizacao).
        // Consumidores autorizados consultam o repository se precisarem.
        await publisher.publish(
          events.personRegistered(auth.actorId, {
            personId: person.id,
            fullName: person.fullName,
            birthDate: body.birthDate,
          }),
        );

        if (body.createLogin === true && body.email !== undefined && body.email !== "") {
          // Application layer encapsula create+setPassword (Arch M1).
          const provision = await provisionUserInIdp(idp, {
            username: usernameFromEmail(body.email),
            name: body.fullName,
            email: body.email,
            initialPassword: body.initialPassword,
            attributes: {
              person_id: person.id,
              cpf: body.cpf,
              org_id: "acdg-default",
              settings: { locale: "pt-BR" },
            },
          });

          if (provision.ok) {
            // Persistir uid (sub do JWT — ADR-023) + pk (mutacoes Management API, HIGH-6).
            await people.setIdpUserId(person.id, provision.data.id, body.email);
            await publisher.publish(
              events.userProvisioned(auth.actorId, {
                personId: person.id,
                idpUserId: provision.data.id,
              }),
            );
          } else {
            // AppSec HIGH-7: nao vazar Authentik message no response.
            console.warn(`[idp] provisionUser failed personId=${person.id} code=${provision.code}`);
            set.status = 207;
            return {
              data: { id: person.id },
              warnings: [
                { code: "IDP-001", message: "Person created but IdP user provisioning failed" },
              ],
              meta: { timestamp: timestamp() },
            };
          }
        }

        set.status = 201;
        return { data: { id: person.id }, meta: { timestamp: timestamp() } };
      },
      {
        body: t.Object({
          fullName: t.String({ minLength: 1, maxLength: 200 }),
          cpf: t.Optional(t.String({ pattern: "^\\d{11}$" })),
          birthDate: t.String({ format: "date" }),
          email: t.Optional(t.String({ format: "email" })),
          createLogin: t.Optional(t.Boolean()),
          initialPassword: t.Optional(t.String({ minLength: 8 })),
        }),
      },
    )

    .get("/people", async ({ headers, query, set }) => {
      const auth = await guard(headers, ["worker", "owner", "admin"], false, {
        resource: "person",
        action: "read",
      }); // GET: actorId do JWT.sub
      if (auth.kind !== "ok") {
        set.status = auth.status;
        return auth.response;
      }

      const result = await people.list({
        search: query["search"] ?? undefined,
        cursor: query["cursor"] ?? undefined,
        limit:
          query["limit"] !== undefined && query["limit"] !== ""
            ? Number(query["limit"])
            : undefined,
      });
      return {
        data: result.data,
        meta: {
          timestamp: timestamp(),
          pageSize: result.data.length,
          totalCount: result.totalCount,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
      };
    })

    .get("/people/by-cpf/:cpf", async ({ headers, params, set }) => {
      const auth = await guard(headers, ["worker", "owner", "admin"], false, {
        resource: "person",
        action: "read",
      }); // GET: actorId do JWT.sub
      if (auth.kind !== "ok") {
        set.status = auth.status;
        return auth.response;
      }

      if (!CPF_RE.test(params.cpf)) {
        set.status = 400;
        return {
          success: false,
          error: { code: "PEO-004", message: "cpf must be exactly 11 digits" },
        };
      }

      const person = await people.findByCpf(params.cpf);
      if (person === null) {
        set.status = 404;
        return { success: false, error: { code: "PEO-002", message: "Person not found" } };
      }
      return { data: person, meta: { timestamp: timestamp() } };
    })

    .get("/people/:personId", async ({ headers, params, set }) => {
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
      return { data: person, meta: { timestamp: timestamp() } };
    })

    .put(
      "/people/:personId",
      async ({ params, body, headers, set }) => {
        const auth = await guard(headers, ["worker", "admin"], true, {
          resource: "person",
          action: "update",
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

        const validation = validateUpdatePerson(body);
        if (validation.kind === "error") {
          set.status = 400;
          return { success: false, error: { code: "PEO-001", message: validation.message } };
        }

        const updated = await people.update(params.personId, body);
        if (updated === null) {
          set.status = 404;
          return { success: false, error: { code: "PEO-002", message: "Person not found" } };
        }

        // AppSec HIGH-8: CPF nao entra em event payload.
        await publisher.publish(
          events.personUpdated(auth.actorId, {
            personId: params.personId,
            fullName: body.fullName,
            birthDate: body.birthDate,
          }),
        );

        // Mantem o IdP em sincronia (name e, se informado, email). Best-effort
        // pos-DB: o registro local e a fonte de verdade; falha vira warning e
        // nao quebra o update (mesma politica do role-sync).
        if (updated.idpUserId !== null) {
          await syncPersonProfileToIdp(idp, {
            idpUserId: updated.idpUserId,
            name: updated.fullName,
            email: body.email,
            personId: params.personId,
          });
        }

        set.status = 204;
      },
      {
        body: t.Object({
          fullName: t.String({ minLength: 1, maxLength: 200 }),
          cpf: t.Optional(t.String({ pattern: "^\\d{11}$" })),
          birthDate: t.String({ format: "date" }),
          email: t.Optional(t.String({ format: "email" })),
        }),
      },
    )

    // ─── Deactivate person + Authentik user ────────────────────────
    .put("/people/:personId/deactivate", async ({ params, headers, set }) => {
      const auth = await guard(headers, ["admin"], true, {
        resource: "person",
        action: "deactivate",
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

      const person = await people.findById(params.personId);
      if (person === null) {
        set.status = 404;
        return { success: false, error: { code: "PEO-002", message: "Person not found" } };
      }
      if (!person.active) {
        set.status = 409;
        return {
          success: false,
          error: { code: "PEO-005", message: "Person is already inactive" },
        };
      }

      // AppSec HIGH-5: IdP PRIMEIRO, DB depois. Sem rollback compensatorio.
      // Se DB falhar apos IdP, registro inconsistente e detectavel por
      // reconciliacao (e o IdP estar deactivated e seguro como degraded mode).
      if (person.idpUserId !== null) {
        const deactivateResult = await idp.deactivateUser(person.idpUserId);
        if (!deactivateResult.ok) {
          // AppSec HIGH-7: NAO vazar Authentik message no response.
          console.warn(
            `[idp] deactivateUser failed pk=${person.idpUserId} code=${deactivateResult.code}`,
          );
          set.status = 502;
          return {
            success: false,
            error: { code: "IDP-002", message: "Failed to deactivate IdP user" },
          };
        }
      }

      const deactivated = await people.deactivate(params.personId);
      if (deactivated === null) {
        // Race: outro request desativou entre findById e deactivate.
        set.status = 409;
        return {
          success: false,
          error: { code: "PEO-005", message: "Person is already inactive" },
        };
      }

      if (person.idpUserId !== null) {
        await publisher.publish(
          events.userDeactivated(auth.actorId, {
            personId: params.personId,
            idpUserId: person.idpUserId,
          }),
        );
      }

      set.status = 204;
    })

    // ─── Reactivate person + Authentik user ────────────────────────
    .put("/people/:personId/reactivate", async ({ params, headers, set }) => {
      const auth = await guard(headers, ["admin"], true, {
        resource: "person",
        action: "reactivate",
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

      const person = await people.findById(params.personId);
      if (person === null) {
        set.status = 404;
        return { success: false, error: { code: "PEO-002", message: "Person not found" } };
      }
      if (person.active) {
        set.status = 409;
        return { success: false, error: { code: "PEO-006", message: "Person is already active" } };
      }

      // AppSec HIGH-5: IdP PRIMEIRO, DB depois.
      if (person.idpUserId !== null) {
        const reactivateResult = await idp.reactivateUser(person.idpUserId);
        if (!reactivateResult.ok) {
          console.warn(
            `[idp] reactivateUser failed pk=${person.idpUserId} code=${reactivateResult.code}`,
          );
          set.status = 502;
          return {
            success: false,
            error: { code: "IDP-003", message: "Failed to reactivate IdP user" },
          };
        }
      }

      const reactivated = await people.reactivate(params.personId);
      if (reactivated === null) {
        set.status = 409;
        return { success: false, error: { code: "PEO-006", message: "Person is already active" } };
      }

      if (person.idpUserId !== null) {
        await publisher.publish(
          events.userReactivated(auth.actorId, {
            personId: params.personId,
            idpUserId: person.idpUserId,
          }),
        );
      }

      set.status = 204;
    })

    // ─── Request password reset (proxy para Authentik recovery) ────
    // ADR-030 + AppSec CRITICAL-2 fix: link NAO retorna no response body.
    // Apenas publica evento NATS para queue-manager montar email PT-BR.
    .post("/people/:personId/request-password-reset", async ({ params, headers, set }) => {
      const auth = await guard(headers, ["admin"], true, {
        resource: "person",
        action: "request-password-reset",
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

      const person = await people.findById(params.personId);
      if (person === null) {
        set.status = 404;
        return { success: false, error: { code: "PEO-002", message: "Person not found" } };
      }

      if (person.idpUserId === null) {
        set.status = 422;
        return { success: false, error: { code: "PEO-007", message: "Person has no IdP login" } };
      }

      const recoveryResult = await idp.requestPasswordReset(person.idpUserId);
      if (!recoveryResult.ok) {
        // AppSec HIGH-7: nao vazar Authentik error message no response.
        console.warn(
          `[idp] requestPasswordReset failed pk=${person.idpUserId} code=${recoveryResult.code}`,
        );
        set.status = 502;
        return {
          success: false,
          error: { code: "IDP-004", message: "Failed to request password reset" },
        };
      }

      // Link NAO sai no response — viaja APENAS no payload do evento NATS.
      // queue-manager consome esse evento, monta email PT-BR + branding ACDG.
      await publisher.publish(
        events.passwordResetRequested(auth.actorId, {
          personId: params.personId,
          idpUserId: person.idpUserId,
          recoveryLink: recoveryResult.data.link,
        }),
      );

      set.status = 202;
      return { meta: { timestamp: timestamp() } };
    })

    // ─── Provisionar login retroativo no IdP ───────────────────────
    // Cria o login no Authentik para uma pessoa que ja existe sem login
    // (criada sem createLogin, ou cujo provisionamento inicial falhou — 207).
    .post(
      "/people/:personId/login",
      async ({ params, body, headers, set }) => {
        const auth = await guard(headers, ["worker", "admin"], true, {
          resource: "person",
          action: "enable-login",
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

        const person = await people.findById(params.personId);
        if (person === null) {
          set.status = 404;
          return { success: false, error: { code: "PEO-002", message: "Person not found" } };
        }

        if (person.idpUserId !== null) {
          set.status = 409;
          return {
            success: false,
            error: { code: "PEO-008", message: "Person already has an IdP login" },
          };
        }

        // email vem do body (override) ou do cadastro da pessoa.
        const email = body.email ?? person.email ?? undefined;
        if (email === undefined || email === "") {
          set.status = 422;
          return {
            success: false,
            error: { code: "PEO-009", message: "email is required to create an IdP login" },
          };
        }

        const provision = await provisionUserInIdp(idp, {
          username: usernameFromEmail(email),
          name: person.fullName,
          email,
          initialPassword: body.initialPassword,
          attributes: {
            person_id: person.id,
            cpf: person.cpf ?? undefined,
            org_id: "acdg-default",
            settings: { locale: "pt-BR" },
          },
        });

        if (!provision.ok) {
          // AppSec HIGH-7: nao vazar Authentik message no response.
          console.warn(
            `[idp] retroactive provision failed personId=${person.id} code=${provision.code}`,
          );
          set.status = 502;
          return {
            success: false,
            error: { code: "IDP-001", message: "Failed to provision IdP user" },
          };
        }

        await people.setIdpUserId(person.id, provision.data.id, email);
        await publisher.publish(
          events.userProvisioned(auth.actorId, {
            personId: person.id,
            idpUserId: provision.data.id,
          }),
        );

        set.status = 201;
        return {
          data: { id: person.id, idpUserId: provision.data.id },
          meta: { timestamp: timestamp() },
        };
      },
      {
        body: t.Object({
          email: t.Optional(t.String({ format: "email" })),
          initialPassword: t.Optional(t.String({ minLength: 8 })),
        }),
      },
    )

    // ─── Erasure: hard-delete pessoa + Authentik user ──────────────
    // LGPD Art. 18 V (eliminacao). Irreversivel e cross-system → superadmin.
    .delete("/people/:personId", async ({ params, headers, set }) => {
      const auth = await guard(headers, ["admin"], true, {
        resource: "person",
        action: "erase",
      });
      if (auth.kind !== "ok") {
        set.status = auth.status;
        return auth.response;
      }

      // Operacao irreversivel e nao escopada a sistema: apenas superadmin.
      if (!isSuperAdmin(auth.auth.roles)) {
        set.status = 403;
        return {
          success: false,
          error: { code: "PEO-010", message: "Only superadmin can delete a person" },
        };
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

      // AppSec HIGH-5: IdP PRIMEIRO, DB depois. Se o delete no Authentik falhar,
      // abortamos antes de tocar o DB (sem orfao no IdP).
      if (person.idpUserId !== null) {
        const del = await idp.deleteUser(person.idpUserId);
        if (!del.ok) {
          console.warn(`[idp] deleteUser failed pk=${person.idpUserId} code=${del.code}`);
          set.status = 502;
          return {
            success: false,
            error: { code: "IDP-005", message: "Failed to delete IdP user" },
          };
        }
      }

      const removed = await people.remove(params.personId);
      if (!removed) {
        // Race: removida por outra request entre findById e remove.
        set.status = 404;
        return { success: false, error: { code: "PEO-002", message: "Person not found" } };
      }

      await publisher.publish(events.personDeleted(auth.actorId, { personId: params.personId }));

      set.status = 204;
    });
