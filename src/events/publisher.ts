import type { JSONValue, Sql } from "postgres";

// ─── Types ──────────────────────────────────────────────────────

export type EventData = Record<string, string | undefined>;

export interface EventPayload {
  readonly metadata: {
    readonly eventId: string;
    readonly occurredAt: string;
    readonly schemaVersion: string;
  };
  readonly actorId: string;
  readonly data: EventData;
}

export interface DomainEvent {
  readonly subject: string;
  readonly payload: EventPayload;
}

export interface EventPublisher {
  readonly publish: (event: DomainEvent) => Promise<void>;
  readonly close: () => Promise<void>;
}

// ─── Outbox publisher (writes to DB, relay publishes to NATS) ──

export const createOutboxPublisher = (sql: Sql): EventPublisher => ({
  publish: async (event) => {
    await sql`
      INSERT INTO outbox_events (subject, payload)
      VALUES (${event.subject}, ${sql.json(event.payload as unknown as JSONValue)})
    `;
  },
  close: async () => {
    /* noop — pool de conexão é encerrado no shutdown do app */
  },
});

// ─── Noop publisher (when DB not available, e.g. in tests) ─────

export const createNoopPublisher = (): EventPublisher => ({
  publish: async () => {
    /* noop — eventos descartados (sem Outbox em teste) */
  },
  close: async () => {
    /* noop */
  },
});

// ─── Event builders ─────────────────────────────────────────────

const buildEvent = (subject: string, actorId: string, data: EventData): DomainEvent => ({
  subject,
  payload: {
    metadata: {
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      schemaVersion: "1.0.0",
    },
    actorId,
    data,
  },
});

// AppSec HIGH-8 + HIGH-9 (LGPD Art. 6º III — minimizacao): CPF e legacy_zitadel_sub
// NAO entram em event payload. Audit trail correlaciona via personId; CPF pode
// ser recuperado por consumer autorizado consultando o repository.
export const events = {
  personRegistered: (
    actorId: string,
    data: { personId: string; fullName: string; birthDate: string },
  ) => buildEvent("people.person.registered", actorId, data),

  personUpdated: (
    actorId: string,
    data: { personId: string; fullName?: string; birthDate?: string },
  ) => buildEvent("people.person.updated", actorId, data),

  // Erasure (LGPD Art. 18 V). Carrega so o personId — consumidores apagam/
  // anonimizam suas projecoes correlacionadas. Sem PII no payload.
  personDeleted: (actorId: string, data: { personId: string }) =>
    buildEvent("people.person.deleted", actorId, data),

  roleAssigned: (actorId: string, data: { personId: string; system: string; role: string }) =>
    buildEvent("people.role.assigned", actorId, data),

  roleDeactivated: (actorId: string, data: { personId: string; system: string; role: string }) =>
    buildEvent("people.role.deactivated", actorId, data),

  roleReactivated: (actorId: string, data: { personId: string; system: string; role: string }) =>
    buildEvent("people.role.reactivated", actorId, data),

  userProvisioned: (actorId: string, data: { personId: string; idpUserId: string }) =>
    buildEvent("people.user.provisioned", actorId, data),

  userDeactivated: (actorId: string, data: { personId: string; idpUserId: string }) =>
    buildEvent("people.user.deactivated", actorId, data),

  userReactivated: (actorId: string, data: { personId: string; idpUserId: string }) =>
    buildEvent("people.user.reactivated", actorId, data),

  // ADR-030 + AppSec CRITICAL-2: recoveryLink viaja apenas no evento NATS,
  // nunca no response HTTP. queue-manager consome este evento para montar email.
  passwordResetRequested: (
    actorId: string,
    data: { personId: string; idpUserId: string; recoveryLink: string },
  ) => buildEvent("people.user.password_reset_requested", actorId, data),
} as const;
