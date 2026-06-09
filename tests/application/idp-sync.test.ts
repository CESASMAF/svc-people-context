import { describe, it, expect } from "bun:test";
import {
  findGroupByRoleKey,
  provisionUserInIdp,
  resolveUniqueUsername,
  roleKeyForGroup,
  syncPersonProfileToIdp,
  syncRoleAssignment,
  syncRoleRemoval,
  usernameFromEmail,
} from "../../src/application/index.ts";
import { createFakeAuthentikClient } from "../routes/fake-authentik.ts";

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

describe("findGroupByRoleKey", () => {
  it("retorna pk do group quando encontrado", async () => {
    const idp = createFakeAuthentikClient();
    const pk = await findGroupByRoleKey(idp, "social-care", "admin");
    expect(pk).not.toBeNull();
    expect(idp.calls.findGroupByName[0]).toBe("social-care:admin");
  });

  it("retorna null quando group nao existe (best-effort + warning)", async () => {
    const idp = createFakeAuthentikClient({ findGroupReturnsNull: true });
    const pk = await findGroupByRoleKey(idp, "social-care", "ghost");
    expect(pk).toBeNull();
  });

  it("retorna null quando IdP retorna error", async () => {
    const idp = createFakeAuthentikClient();
    // Forcar erro substituindo findGroupByName por uma versao que falha
    const breaking = {
      ...idp,
      findGroupByName: async () => ({ ok: false as const, code: 500, message: "boom" }),
    };
    const pk = await findGroupByRoleKey(breaking, "social-care", "admin");
    expect(pk).toBeNull();
  });
});

describe("syncRoleAssignment", () => {
  it("adiciona user ao group quando group existe", async () => {
    const idp = createFakeAuthentikClient();
    await syncRoleAssignment(idp, {
      system: "social-care",
      role: "admin",
      idpUserPk: 42,
      personId: "person-1",
    });
    expect(idp.calls.addUserToGroup.length).toBe(1);
    expect(idp.calls.addUserToGroup[0]!.userPk).toBe(42);
  });

  it("nao chama addUserToGroup quando group nao existe", async () => {
    const idp = createFakeAuthentikClient({ findGroupReturnsNull: true });
    await syncRoleAssignment(idp, {
      system: "social-care",
      role: "ghost",
      idpUserPk: 42,
      personId: "person-1",
    });
    expect(idp.calls.addUserToGroup.length).toBe(0);
  });

  it("loga warning mas nao throw quando addUserToGroup falha", async () => {
    const idp = createFakeAuthentikClient({
      addUserToGroupFails: { code: 500, message: "internal" },
    });
    // Nao deve throw
    await syncRoleAssignment(idp, {
      system: "social-care",
      role: "admin",
      idpUserPk: 42,
      personId: "person-1",
    });
    expect(idp.calls.addUserToGroup.length).toBe(1);
  });
});

describe("syncRoleRemoval", () => {
  it("remove user do group quando group existe", async () => {
    const idp = createFakeAuthentikClient();
    await syncRoleRemoval(idp, {
      system: "social-care",
      role: "admin",
      idpUserPk: 42,
      personId: "person-1",
    });
    expect(idp.calls.removeUserFromGroup.length).toBe(1);
    expect(idp.calls.removeUserFromGroup[0]!.userPk).toBe(42);
  });

  it("nao chama removeUserFromGroup quando group nao existe", async () => {
    const idp = createFakeAuthentikClient({ findGroupReturnsNull: true });
    await syncRoleRemoval(idp, {
      system: "social-care",
      role: "ghost",
      idpUserPk: 42,
      personId: "person-1",
    });
    expect(idp.calls.removeUserFromGroup.length).toBe(0);
  });

  it("loga warning mas nao throw quando removeUserFromGroup falha", async () => {
    const idp = createFakeAuthentikClient({
      removeUserFromGroupFails: { code: 500, message: "internal" },
    });
    await syncRoleRemoval(idp, {
      system: "social-care",
      role: "admin",
      idpUserPk: 42,
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

  it("cria user sem password retorna uid + pk", async () => {
    const idp = createFakeAuthentikClient({ createUserPk: 99, createUserUid: "uid-99" });
    const result = await provisionUserInIdp(idp, baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.pk).toBe(99);
      expect(result.data.uid).toBe("uid-99");
    }
    expect(idp.calls.setPassword.length).toBe(0);
  });

  it("cria user e seta password quando initialPassword presente", async () => {
    const idp = createFakeAuthentikClient({ createUserPk: 99 });
    const result = await provisionUserInIdp(idp, {
      ...baseInput,
      initialPassword: "secret-123",
    });

    expect(result.ok).toBe(true);
    expect(idp.calls.setPassword.length).toBe(1);
    expect(idp.calls.setPassword[0]).toEqual({ pk: 99, password: "secret-123" });
  });

  it("retorna error quando createUser falha (sem chamar setPassword)", async () => {
    const idp = createFakeAuthentikClient({
      createUserFails: { code: 409, message: "username already exists" },
    });
    const result = await provisionUserInIdp(idp, {
      ...baseInput,
      initialPassword: "secret-123",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(409);
    }
    expect(idp.calls.setPassword.length).toBe(0);
  });

  it("retorna ok mesmo se setPassword falhar (warning, user ja criado)", async () => {
    const idp = createFakeAuthentikClient({
      createUserPk: 99,
      setPasswordFails: { code: 400, message: "weak password" },
    });
    const result = await provisionUserInIdp(idp, {
      ...baseInput,
      initialPassword: "weak",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.pk).toBe(99);
    }
    expect(idp.calls.setPassword.length).toBe(1);
  });

  it("re-tenta apos 409 transitorio (race) e sucede", async () => {
    const idp = createFakeAuthentikClient({ createUserPk: 99, createUserFailsTimes: 1 });
    const result = await provisionUserInIdp(idp, baseInput);
    expect(result.ok).toBe(true);
    // 1a tentativa falha 409, 2a sucede.
    expect(idp.calls.createUser.length).toBe(2);
  });

  it("desiste apos 409 persistente (esgota tentativas)", async () => {
    const idp = createFakeAuthentikClient({ createUserFailsTimes: 99 });
    const result = await provisionUserInIdp(idp, baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(409);
    expect(idp.calls.createUser.length).toBe(3); // PROVISION_MAX_ATTEMPTS
  });
});

describe("resolveUniqueUsername", () => {
  it("retorna o base quando livre", async () => {
    const idp = createFakeAuthentikClient();
    expect(await resolveUniqueUsername(idp, "joao")).toBe("joao");
  });

  it("sufixa com 2 quando base ocupado", async () => {
    const idp = createFakeAuthentikClient({ takenUsernames: ["joao"] });
    expect(await resolveUniqueUsername(idp, "joao")).toBe("joao2");
  });

  it("pula multiplos ocupados consecutivos", async () => {
    const idp = createFakeAuthentikClient({ takenUsernames: ["joao", "joao2", "joao3"] });
    expect(await resolveUniqueUsername(idp, "joao")).toBe("joao4");
  });

  it("devolve o candidato quando a checagem do IdP falha", async () => {
    const idp = createFakeAuthentikClient();
    const breaking = {
      ...idp,
      findUserByUsername: async () => ({ ok: false as const, code: 500, message: "down" }),
    };
    expect(await resolveUniqueUsername(breaking, "joao")).toBe("joao");
  });

  it("usa fragmento aleatorio quando esgota as tentativas", async () => {
    const taken = ["joao", ...Array.from({ length: 49 }, (_, i) => `joao${i + 2}`)];
    const idp = createFakeAuthentikClient({ takenUsernames: taken });
    const result = await resolveUniqueUsername(idp, "joao");
    expect(result.startsWith("joao-")).toBe(true);
    expect(result.length).toBe("joao-".length + 8);
  });
});

describe("syncPersonProfileToIdp", () => {
  it("atualiza name e email no IdP", async () => {
    const idp = createFakeAuthentikClient();
    await syncPersonProfileToIdp(idp, {
      idpUserPk: 7,
      name: "Novo Nome",
      email: "n@x.com",
      personId: "p-1",
    });
    expect(idp.calls.updateUserProfile.length).toBe(1);
    expect(idp.calls.updateUserProfile[0]).toEqual({ pk: 7, name: "Novo Nome", email: "n@x.com" });
  });

  it("omite email quando nao informado (so atualiza name)", async () => {
    const idp = createFakeAuthentikClient();
    await syncPersonProfileToIdp(idp, { idpUserPk: 7, name: "Novo Nome", personId: "p-1" });
    expect(idp.calls.updateUserProfile[0]).toEqual({ pk: 7, name: "Novo Nome", email: undefined });
  });

  it("loga warning sem throw quando o IdP falha", async () => {
    const idp = createFakeAuthentikClient({ updateProfileFails: { code: 500, message: "boom" } });
    await syncPersonProfileToIdp(idp, { idpUserPk: 7, name: "Novo Nome", personId: "p-1" });
    expect(idp.calls.updateUserProfile.length).toBe(1);
  });
});
