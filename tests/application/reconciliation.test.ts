import { describe, it, expect } from "bun:test";
import { reconcileIdpState, type ReconcilablePerson } from "../../src/application/index.ts";
import { createFakeIdpClient } from "../routes/fake-idp.ts";

describe("reconcileIdpState", () => {
  it("conta inSync quando DB e IdP coincidem", async () => {
    const idp = createFakeIdpClient({ getUserActiveById: { "id-101": true } });
    const people: ReconcilablePerson[] = [{ id: "p-1", idpUserId: "id-101", active: true }];

    const report = await reconcileIdpState(idp, people);

    expect(report.checked).toBe(1);
    expect(report.inSync).toBe(1);
    expect(report.fixed.length).toBe(0);
    expect(idp.calls.reactivateUser.length).toBe(0);
    expect(idp.calls.deactivateUser.length).toBe(0);
  });

  it("desativa no IdP quando DB esta inativo mas IdP ativo", async () => {
    const idp = createFakeIdpClient({ getUserActiveById: { "id-101": true } });
    const people: ReconcilablePerson[] = [{ id: "p-1", idpUserId: "id-101", active: false }];

    const report = await reconcileIdpState(idp, people);

    expect(idp.calls.deactivateUser).toEqual(["id-101"]);
    expect(report.fixed).toEqual([{ personId: "p-1", idpUserId: "id-101", from: true, to: false }]);
  });

  it("reativa no IdP quando DB esta ativo mas IdP inativo", async () => {
    const idp = createFakeIdpClient({ getUserActiveById: { "id-101": false } });
    const people: ReconcilablePerson[] = [{ id: "p-1", idpUserId: "id-101", active: true }];

    const report = await reconcileIdpState(idp, people);

    expect(idp.calls.reactivateUser).toEqual(["id-101"]);
    expect(report.fixed[0]).toEqual({
      personId: "p-1",
      idpUserId: "id-101",
      from: false,
      to: true,
    });
  });

  it("registra erro de fetch sem aplicar correcao", async () => {
    const idp = createFakeIdpClient({ getUserFailsById: { "id-101": 404 } });
    const people: ReconcilablePerson[] = [{ id: "p-1", idpUserId: "id-101", active: true }];

    const report = await reconcileIdpState(idp, people);

    expect(report.fixed.length).toBe(0);
    expect(report.errors).toEqual([
      { personId: "p-1", idpUserId: "id-101", stage: "fetch", code: 404 },
    ]);
  });

  it("registra erro de apply quando a correcao no IdP falha", async () => {
    const idp = createFakeIdpClient({
      getUserActiveById: { "id-101": false },
      reactivateFails: { code: 500, message: "down" },
    });
    const people: ReconcilablePerson[] = [{ id: "p-1", idpUserId: "id-101", active: true }];

    const report = await reconcileIdpState(idp, people);

    expect(report.fixed.length).toBe(0);
    expect(report.errors).toEqual([
      { personId: "p-1", idpUserId: "id-101", stage: "apply", code: 500 },
    ]);
  });

  it("processa varias pessoas com mix de estados", async () => {
    const idp = createFakeIdpClient({
      getUserActiveById: { "id-101": true, "id-102": false, "id-103": true },
    });
    const people: ReconcilablePerson[] = [
      { id: "p-1", idpUserId: "id-101", active: true }, // in sync
      { id: "p-2", idpUserId: "id-102", active: true }, // precisa reativar
      { id: "p-3", idpUserId: "id-103", active: false }, // precisa desativar
    ];

    const report = await reconcileIdpState(idp, people);

    expect(report.checked).toBe(3);
    expect(report.inSync).toBe(1);
    expect(report.fixed.length).toBe(2);
  });
});
