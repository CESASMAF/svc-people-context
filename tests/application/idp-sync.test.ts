import { describe, it, expect } from "bun:test";
import {
  provisionUserInIdp,
  roleKeyForGroup,
  syncPersonProfileToIdp,
  syncRoleAssignment,
  syncRoleRemoval,
  usernameFromEmail,
} from "../../src/application/index.ts";
import { createFakeIdpClient } from "../routes/fake-idp.ts";

describe("roleKeyForGroup", () => {
  it("formata system:role", () => {
    expect(roleKeyForGroup("social-care", "admin")).toBe("social-care:admin");
    expect(roleKeyForGroup("queue-manager", "worker")).toBe("queue-manager:worker");
  });
});

describe("usernameFromEmail", () => {
  it("extrai parte antes do @", () => {
    expect(usernameFromEmail("joao@example.com")).toBe("joao");
  });

  it("converte para minusculas", () => {
    expect(usernameFromEmail("JOAO.SILVA@EXAMPLE.COM")).toBe("joao.silva");
  });

  it("retorna o email original em minusculas quando nao tem @", () => {
    expect(usernameFromEmail("semarroba")).toBe("semarroba");
  });
});

describe("syncRoleAssignment", () => {
  it("adiciona user ao group com a chave system:role", async () => {
    const idp = createFakeIdpClient();
    await syncRoleAssignment(idp, {
      system: "social-care",
      role: "admin",
      idpUserId: "id-42",
      personId: "person-1",
    });
    expect(idp.calls.addUserToGroup.length).toBe(1);
    expect(idp.calls.addUserToGroup[0]!.group).toBe("social-care:admin");
    expect(idp.calls.addUserToGroup[0]!.id).toBe("id-42");
  });

  it("loga warning mas nao throw quando addUserToGroup falha", async () => {
    const idp = createFakeIdpClient({
      addUserToGroupFails: { code: 500, message: "internal" },
    });
    // Nao deve throw
    await syncRoleAssignment(idp, {
      system: "social-care",
      role: "admin",
      idpUserId: "id-42",
      personId: "person-1",
    });
    expect(idp.calls.addUserToGroup.length).toBe(1);
  });
});

describe("syncRoleRemoval", () => {
  it("remove user do group com a chave system:role", async () => {
    const idp = createFakeIdpClient();
    await syncRoleRemoval(idp, {
      system: "social-care",
      role: "admin",
      idpUserId: "id-42",
      personId: "person-1",
    });
    expect(idp.calls.removeUserFromGroup.length).toBe(1);
    expect(idp.calls.removeUserFromGroup[0]!.group).toBe("social-care:admin");
    expect(idp.calls.removeUserFromGroup[0]!.id).toBe("id-42");
  });

  it("loga warning mas nao throw quando removeUserFromGroup falha", async () => {
    const idp = createFakeIdpClient({
      removeUserFromGroupFails: { code: 500, message: "internal" },
    });
    await syncRoleRemoval(idp, {
      system: "social-care",
      role: "admin",
      idpUserId: "id-42",
      personId: "person-1",
    });
    expect(idp.calls.removeUserFromGroup.length).toBe(1);
  });
});

describe("provisionUserInIdp", () => {
  const baseInput = {
    username: "joao",
    name: "Joao Silva",
    email: "joao@example.com",
    attributes: { person_id: "p-1", org_id: "acdg-default" },
  };

  it("cria user sem password e retorna id", async () => {
    const idp = createFakeIdpClient({ createUserId: "id-99" });
    const result = await provisionUserInIdp(idp, baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe("id-99");
    }
    expect(idp.calls.createUser.length).toBe(1);
    // sem initialPassword → createUser sem senha; setPassword nao e chamado.
    expect(idp.calls.createUser[0]!.password).toBeUndefined();
    expect(idp.calls.setPassword.length).toBe(0);
  });

  it("passa initialPassword direto no createUser (credentials do Kratos)", async () => {
    const idp = createFakeIdpClient({ createUserId: "id-99" });
    const result = await provisionUserInIdp(idp, {
      ...baseInput,
      initialPassword: "secret-123",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe("id-99");
    expect(idp.calls.createUser.length).toBe(1);
    expect(idp.calls.createUser[0]!.password).toBe("secret-123");
    // Kratos grava a senha no createUser — nada de setPassword separado.
    expect(idp.calls.setPassword.length).toBe(0);
  });

  it("retorna error quando createUser falha", async () => {
    const idp = createFakeIdpClient({
      createUserFails: { code: 409, message: "email already exists" },
    });
    const result = await provisionUserInIdp(idp, {
      ...baseInput,
      initialPassword: "secret-123",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(409);
    }
  });
});

describe("syncPersonProfileToIdp", () => {
  it("atualiza name e email no IdP", async () => {
    const idp = createFakeIdpClient();
    await syncPersonProfileToIdp(idp, {
      idpUserId: "id-7",
      name: "Novo Nome",
      email: "n@x.com",
      personId: "p-1",
    });
    expect(idp.calls.updateUserProfile.length).toBe(1);
    expect(idp.calls.updateUserProfile[0]).toEqual({
      id: "id-7",
      name: "Novo Nome",
      email: "n@x.com",
    });
  });

  it("omite email quando nao informado (so atualiza name)", async () => {
    const idp = createFakeIdpClient();
    await syncPersonProfileToIdp(idp, { idpUserId: "id-7", name: "Novo Nome", personId: "p-1" });
    expect(idp.calls.updateUserProfile[0]).toEqual({
      id: "id-7",
      name: "Novo Nome",
      email: undefined,
    });
  });

  it("loga warning sem throw quando o IdP falha", async () => {
    const idp = createFakeIdpClient({ updateProfileFails: { code: 500, message: "boom" } });
    await syncPersonProfileToIdp(idp, { idpUserId: "id-7", name: "Novo Nome", personId: "p-1" });
    expect(idp.calls.updateUserProfile.length).toBe(1);
  });
});
