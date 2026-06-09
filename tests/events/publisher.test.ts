import { describe, it, expect } from "bun:test";
import {
  events,
  createNoopPublisher,
  createOutboxPublisher,
  type DomainEvent,
} from "../../src/events/publisher.ts";

// ─── Event builders ────────────────────────────────────────────

describe("events.personRegistered", () => {
  it("builds a valid domain event", () => {
    const event = events.personRegistered("actor-1", {
      personId: "p-1",
      fullName: "Ana Costa",
      birthDate: "1990-05-15",
    });
    expect(event.subject).toBe("people.person.registered");
    expect(event.payload.actorId).toBe("actor-1");
    expect(event.payload.data.personId).toBe("p-1");
    expect(event.payload.data.fullName).toBe("Ana Costa");
    expect(event.payload.metadata.eventId).toBeDefined();
    expect(event.payload.metadata.occurredAt).toBeDefined();
    expect(event.payload.metadata.schemaVersion).toBe("1.0.0");
  });

  it("does not leak CPF in event payload (LGPD minimizacao — AppSec HIGH-8)", () => {
    const event = events.personRegistered("actor-1", {
      personId: "p-2",
      fullName: "João Silva",
      birthDate: "1985-06-20",
    });
    expect((event.payload.data as Record<string, unknown>)["cpf"]).toBeUndefined();
  });
});

describe("events.personUpdated", () => {
  it("builds a valid domain event", () => {
    const event = events.personUpdated("actor-2", {
      personId: "p-1",
      fullName: "Ana Silva",
    });
    expect(event.subject).toBe("people.person.updated");
    expect(event.payload.actorId).toBe("actor-2");
    expect(event.payload.data.personId).toBe("p-1");
  });
});

describe("events.roleAssigned", () => {
  it("builds a valid domain event", () => {
    const event = events.roleAssigned("actor-3", {
      personId: "p-1",
      system: "social-care",
      role: "patient",
    });
    expect(event.subject).toBe("people.role.assigned");
    expect(event.payload.data.system).toBe("social-care");
    expect(event.payload.data.role).toBe("patient");
  });
});

describe("events.roleDeactivated", () => {
  it("builds a valid domain event", () => {
    const event = events.roleDeactivated("actor-4", {
      personId: "p-1",
      system: "social-care",
      role: "patient",
    });
    expect(event.subject).toBe("people.role.deactivated");
  });
});

describe("events.roleReactivated", () => {
  it("builds a valid domain event", () => {
    const event = events.roleReactivated("actor-5", {
      personId: "p-1",
      system: "social-care",
      role: "patient",
    });
    expect(event.subject).toBe("people.role.reactivated");
  });
});

// ─── Event metadata uniqueness ─────────────────────────────────

describe("event metadata", () => {
  it("generates unique eventIds for different events", () => {
    const e1 = events.personRegistered("a", {
      personId: "p",
      fullName: "X",
      birthDate: "2000-01-01",
    });
    const e2 = events.personRegistered("a", {
      personId: "p",
      fullName: "X",
      birthDate: "2000-01-01",
    });
    expect(e1.payload.metadata.eventId).not.toBe(e2.payload.metadata.eventId);
  });
});

// ─── Noop publisher ────────────────────────────────────────────

describe("createNoopPublisher", () => {
  it("publish does nothing (no errors)", async () => {
    const publisher = createNoopPublisher();
    const event = events.personRegistered("a", {
      personId: "p",
      fullName: "X",
      birthDate: "2000-01-01",
    });
    await publisher.publish(event);
    // no error = success
  });

  it("close does nothing (no errors)", async () => {
    const publisher = createNoopPublisher();
    await publisher.close();
  });
});

// ─── Outbox publisher ──────────────────────────────────────────

describe("createOutboxPublisher", () => {
  it("writes event to outbox table using sql.json()", async () => {
    const inserted: { subject: string; payload: unknown }[] = [];

    const fakeSql = Object.assign(
      (strings: TemplateStringsArray, ...params: unknown[]) => {
        if (strings.join("").includes("INSERT INTO outbox_events")) {
          inserted.push({ subject: params[0] as string, payload: params[1] });
        }
        return Promise.resolve([]);
      },
      { json: (value: unknown) => value },
    ) as unknown as import("postgres").Sql;

    const publisher = createOutboxPublisher(fakeSql);
    const event = events.personRegistered("actor-1", {
      personId: "p-1",
      fullName: "Ana Costa",
      birthDate: "1990-05-15",
    });

    await publisher.publish(event);

    expect(inserted.length).toBe(1);
    expect(inserted[0]!.subject).toBe("people.person.registered");
    const payload = inserted[0]!.payload as DomainEvent["payload"];
    expect(payload.actorId).toBe("actor-1");
    expect(payload.data.personId).toBe("p-1");
  });
});
