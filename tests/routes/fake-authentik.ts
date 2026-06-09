import type {
  AuthentikClient,
  AuthentikGroupPk,
  AuthentikResult,
  AuthentikUserPk,
  GroupSummary,
  UserResponse,
} from "../../src/idp/index.ts";

// Fake AuthentikClient configurável para testar paths de sucesso e falha
// nas rotas sem mockar globalmente o `fetch`.

const ok = <T>(data: T): AuthentikResult<T> => ({ ok: true, data });
const err = (code: number, message = "fake error"): AuthentikResult<never> => ({
  ok: false,
  code,
  message,
});

const stubUser = (overrides: Partial<UserResponse> = {}): UserResponse => ({
  pk: 1,
  uid: "fake-uid",
  username: "fake",
  name: "Fake User",
  email: "fake@example.com",
  is_active: true,
  is_superuser: false,
  groups: [],
  attributes: {},
  date_joined: new Date().toISOString(),
  last_login: null,
  ...overrides,
});

export interface FakeAuthentikOverrides {
  readonly createUserFails?: { code: number; message?: string };
  readonly setPasswordFails?: { code: number; message?: string };
  readonly deactivateFails?: { code: number; message?: string };
  readonly reactivateFails?: { code: number; message?: string };
  readonly requestPasswordResetFails?: { code: number; message?: string };
  readonly findGroupReturnsNull?: boolean;
  readonly addUserToGroupFails?: { code: number; message?: string };
  readonly removeUserFromGroupFails?: { code: number; message?: string };
  readonly deleteUserFails?: { code: number; message?: string };
  readonly updateProfileFails?: { code: number; message?: string };
  readonly createUserPk?: number;
  readonly createUserUid?: string;
  readonly recoveryLink?: string | null;
  // Usernames que ja existem no IdP — findUserByUsername devolve stub p/ eles,
  // null para o resto. Usado nos testes de resolucao de username unico.
  readonly takenUsernames?: readonly string[];
  // createUser falha apenas nas N primeiras chamadas (simula race 409 + retry).
  readonly createUserFailsTimes?: number;
  // Estado is_active devolvido por getUser(pk) — usado na reconciliacao.
  readonly getUserActiveByPk?: Readonly<Record<number, boolean>>;
  // pks cujo getUser falha — usado na reconciliacao.
  readonly getUserFailsByPk?: Readonly<Record<number, number>>;
}

export type FakeAuthentikClient = AuthentikClient & {
  readonly calls: {
    readonly createUser: { username: string }[];
    readonly setPassword: { pk: AuthentikUserPk; password: string }[];
    readonly deactivateUser: AuthentikUserPk[];
    readonly reactivateUser: AuthentikUserPk[];
    readonly requestPasswordReset: AuthentikUserPk[];
    readonly addUserToGroup: { groupPk: AuthentikGroupPk; userPk: AuthentikUserPk }[];
    readonly removeUserFromGroup: { groupPk: AuthentikGroupPk; userPk: AuthentikUserPk }[];
    readonly findGroupByName: string[];
    readonly findUserByUsername: string[];
    readonly deleteUser: AuthentikUserPk[];
    readonly updateUserProfile: { pk: AuthentikUserPk; name?: string; email?: string }[];
    readonly getUser: AuthentikUserPk[];
  };
};

export const createFakeAuthentikClient = (
  overrides: FakeAuthentikOverrides = {},
): FakeAuthentikClient => {
  const calls = {
    createUser: [] as { username: string }[],
    setPassword: [] as { pk: AuthentikUserPk; password: string }[],
    deactivateUser: [] as AuthentikUserPk[],
    reactivateUser: [] as AuthentikUserPk[],
    requestPasswordReset: [] as AuthentikUserPk[],
    addUserToGroup: [] as { groupPk: AuthentikGroupPk; userPk: AuthentikUserPk }[],
    removeUserFromGroup: [] as { groupPk: AuthentikGroupPk; userPk: AuthentikUserPk }[],
    findGroupByName: [] as string[],
    findUserByUsername: [] as string[],
    deleteUser: [] as AuthentikUserPk[],
    updateUserProfile: [] as { pk: AuthentikUserPk; name?: string; email?: string }[],
    getUser: [] as AuthentikUserPk[],
  };
  const taken = new Set(overrides.takenUsernames ?? []);
  let createUserFailsRemaining = overrides.createUserFailsTimes ?? 0;

  const groupStub: GroupSummary = {
    pk: "00000000-0000-0000-0000-000000000099",
    name: "fake-group",
    is_superuser: false,
  };

  return {
    calls,

    createUser: async (input) => {
      calls.createUser.push({ username: input.username });
      if (overrides.createUserFails) {
        return err(overrides.createUserFails.code, overrides.createUserFails.message);
      }
      // Falha transitoria (race 409) nas N primeiras chamadas, depois sucede.
      if (createUserFailsRemaining > 0) {
        createUserFailsRemaining--;
        return err(409, "username conflict");
      }
      return ok(
        stubUser({
          pk: overrides.createUserPk ?? 42,
          uid: overrides.createUserUid ?? "uid-42",
          username: input.username,
          name: input.name,
          email: input.email,
        }),
      );
    },

    getUser: async (pk) => {
      calls.getUser.push(pk);
      const failCode = overrides.getUserFailsByPk?.[pk];
      if (failCode !== undefined) return err(failCode, "getUser failed");
      const isActive = overrides.getUserActiveByPk?.[pk] ?? true;
      return ok(stubUser({ pk, is_active: isActive }));
    },
    findUserByUsername: async (username) => {
      calls.findUserByUsername.push(username);
      if (taken.has(username)) return ok(stubUser({ username }));
      return ok(null);
    },
    findUserByUid: async () => ok(null),

    setPassword: async (pk, password) => {
      calls.setPassword.push({ pk, password });
      if (overrides.setPasswordFails) {
        return err(overrides.setPasswordFails.code, overrides.setPasswordFails.message);
      }
      return ok(undefined);
    },

    deactivateUser: async (pk) => {
      calls.deactivateUser.push(pk);
      if (overrides.deactivateFails) {
        return err(overrides.deactivateFails.code, overrides.deactivateFails.message);
      }
      return ok(undefined);
    },

    reactivateUser: async (pk) => {
      calls.reactivateUser.push(pk);
      if (overrides.reactivateFails) {
        return err(overrides.reactivateFails.code, overrides.reactivateFails.message);
      }
      return ok(undefined);
    },

    deleteUser: async (pk) => {
      calls.deleteUser.push(pk);
      if (overrides.deleteUserFails) {
        return err(overrides.deleteUserFails.code, overrides.deleteUserFails.message);
      }
      return ok(undefined);
    },
    updateUserAttributes: async (pk) => ok(stubUser({ pk })),
    updateUserProfile: async (pk, patch) => {
      calls.updateUserProfile.push({ pk, name: patch.name, email: patch.email });
      if (overrides.updateProfileFails) {
        return err(overrides.updateProfileFails.code, overrides.updateProfileFails.message);
      }
      return ok(stubUser({ pk, name: patch.name, email: patch.email }));
    },

    requestPasswordReset: async (pk) => {
      calls.requestPasswordReset.push(pk);
      if (overrides.requestPasswordResetFails) {
        return err(
          overrides.requestPasswordResetFails.code,
          overrides.requestPasswordResetFails.message,
        );
      }
      return ok({ link: overrides.recoveryLink ?? "https://fake/recovery?token=t" });
    },

    findGroupByName: async (name) => {
      calls.findGroupByName.push(name);
      if (overrides.findGroupReturnsNull) return ok(null);
      return ok({ ...groupStub, name });
    },

    addUserToGroup: async (groupPk, userPk) => {
      calls.addUserToGroup.push({ groupPk, userPk });
      if (overrides.addUserToGroupFails) {
        return err(overrides.addUserToGroupFails.code, overrides.addUserToGroupFails.message);
      }
      return ok(undefined);
    },

    removeUserFromGroup: async (groupPk, userPk) => {
      calls.removeUserFromGroup.push({ groupPk, userPk });
      if (overrides.removeUserFromGroupFails) {
        return err(
          overrides.removeUserFromGroupFails.code,
          overrides.removeUserFromGroupFails.message,
        );
      }
      return ok(undefined);
    },

    listUserGroups: async () => ok([]),
    createServiceAccount: async (input) =>
      ok({
        username: input.name,
        token: "fake-sa-token",
        user_uid: "sa-uid",
        user_pk: 99,
      }),
  };
};
