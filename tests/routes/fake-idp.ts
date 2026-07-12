import type {
  CreateUserInput,
  IdpClient,
  IdpResult,
  IdpUser,
  IdpUserId,
  UpdateUserProfileInput,
} from "../../src/idp/index.ts";

// Fake IdpClient (Ory Kratos) configuravel para testar paths de sucesso e falha
// nas rotas sem mockar globalmente o `fetch`. Um "user" tem um unico id (string
// UUID) — nao ha mais `pk`/`uid` separados como no Authentik.

const ok = <T>(data: T): IdpResult<T> => ({ ok: true, data });
const err = (code: number, message = "fake error"): IdpResult<never> => ({
  ok: false,
  code,
  message,
});

const stubUser = (overrides: Partial<IdpUser> = {}): IdpUser => ({
  id: "fake-id",
  username: "fake",
  name: "Fake User",
  email: "fake@example.com",
  active: true,
  groups: [],
  attributes: {},
  createdAt: new Date().toISOString(),
  ...overrides,
});

export interface FakeIdpOverrides {
  readonly createUserFails?: { code: number; message?: string };
  readonly setPasswordFails?: { code: number; message?: string };
  readonly deactivateFails?: { code: number; message?: string };
  readonly reactivateFails?: { code: number; message?: string };
  readonly requestPasswordResetFails?: { code: number; message?: string };
  readonly addUserToGroupFails?: { code: number; message?: string };
  readonly removeUserFromGroupFails?: { code: number; message?: string };
  readonly deleteUserFails?: { code: number; message?: string };
  readonly updateProfileFails?: { code: number; message?: string };
  // id (UUID) devolvido por createUser — persistido como idpUserId.
  readonly createUserId?: string;
  readonly recoveryLink?: string | null;
  // Estado active devolvido por getUser(id) — usado na reconciliacao.
  readonly getUserActiveById?: Readonly<Record<string, boolean>>;
  // ids cujo getUser falha — usado na reconciliacao.
  readonly getUserFailsById?: Readonly<Record<string, number>>;
}

export type FakeIdpClient = IdpClient & {
  readonly calls: {
    readonly createUser: { username: string; email: string; password?: string }[];
    readonly getUser: IdpUserId[];
    readonly findUserByEmail: string[];
    readonly setPassword: { id: IdpUserId; password: string }[];
    readonly deactivateUser: IdpUserId[];
    readonly reactivateUser: IdpUserId[];
    readonly deleteUser: IdpUserId[];
    readonly updateUserAttributes: { id: IdpUserId }[];
    readonly updateUserProfile: { id: IdpUserId; name?: string; email?: string }[];
    readonly requestPasswordReset: IdpUserId[];
    readonly addUserToGroup: { group: string; id: IdpUserId }[];
    readonly removeUserFromGroup: { group: string; id: IdpUserId }[];
    readonly listUserGroups: IdpUserId[];
  };
};

export const createFakeIdpClient = (overrides: FakeIdpOverrides = {}): FakeIdpClient => {
  const calls = {
    createUser: [] as { username: string; email: string; password?: string }[],
    getUser: [] as IdpUserId[],
    findUserByEmail: [] as string[],
    setPassword: [] as { id: IdpUserId; password: string }[],
    deactivateUser: [] as IdpUserId[],
    reactivateUser: [] as IdpUserId[],
    deleteUser: [] as IdpUserId[],
    updateUserAttributes: [] as { id: IdpUserId }[],
    updateUserProfile: [] as { id: IdpUserId; name?: string; email?: string }[],
    requestPasswordReset: [] as IdpUserId[],
    addUserToGroup: [] as { group: string; id: IdpUserId }[],
    removeUserFromGroup: [] as { group: string; id: IdpUserId }[],
    listUserGroups: [] as IdpUserId[],
  };

  const defaultId = overrides.createUserId ?? "fake-id";

  return {
    calls,

    createUser: async (input: CreateUserInput) => {
      calls.createUser.push({
        username: input.username,
        email: input.email,
        ...(input.password !== undefined ? { password: input.password } : {}),
      });
      if (overrides.createUserFails) {
        return err(overrides.createUserFails.code, overrides.createUserFails.message);
      }
      return ok(
        stubUser({
          id: defaultId,
          username: input.username,
          name: input.name,
          email: input.email,
          active: input.is_active !== false,
          groups: input.groups ?? [],
          attributes: input.attributes ?? {},
        }),
      );
    },

    getUser: async (id) => {
      calls.getUser.push(id);
      const failCode = overrides.getUserFailsById?.[id];
      if (failCode !== undefined) return err(failCode, "getUser failed");
      const active = overrides.getUserActiveById?.[id] ?? true;
      return ok(stubUser({ id, active }));
    },

    findUserByEmail: async (email) => {
      calls.findUserByEmail.push(email);
      return ok(null);
    },

    setPassword: async (id, password) => {
      calls.setPassword.push({ id, password });
      if (overrides.setPasswordFails) {
        return err(overrides.setPasswordFails.code, overrides.setPasswordFails.message);
      }
      return ok(undefined);
    },

    deactivateUser: async (id) => {
      calls.deactivateUser.push(id);
      if (overrides.deactivateFails) {
        return err(overrides.deactivateFails.code, overrides.deactivateFails.message);
      }
      return ok(undefined);
    },

    reactivateUser: async (id) => {
      calls.reactivateUser.push(id);
      if (overrides.reactivateFails) {
        return err(overrides.reactivateFails.code, overrides.reactivateFails.message);
      }
      return ok(undefined);
    },

    deleteUser: async (id) => {
      calls.deleteUser.push(id);
      if (overrides.deleteUserFails) {
        return err(overrides.deleteUserFails.code, overrides.deleteUserFails.message);
      }
      return ok(undefined);
    },

    updateUserAttributes: async (id) => {
      calls.updateUserAttributes.push({ id });
      return ok(stubUser({ id }));
    },

    updateUserProfile: async (id, patch: UpdateUserProfileInput) => {
      calls.updateUserProfile.push({ id, name: patch.name, email: patch.email });
      if (overrides.updateProfileFails) {
        return err(overrides.updateProfileFails.code, overrides.updateProfileFails.message);
      }
      return ok(stubUser({ id, name: patch.name, email: patch.email }));
    },

    requestPasswordReset: async (id) => {
      calls.requestPasswordReset.push(id);
      if (overrides.requestPasswordResetFails) {
        return err(
          overrides.requestPasswordResetFails.code,
          overrides.requestPasswordResetFails.message,
        );
      }
      return ok({ link: overrides.recoveryLink ?? "https://fake/recovery?token=t" });
    },

    addUserToGroup: async (group, id) => {
      calls.addUserToGroup.push({ group, id });
      if (overrides.addUserToGroupFails) {
        return err(overrides.addUserToGroupFails.code, overrides.addUserToGroupFails.message);
      }
      return ok(undefined);
    },

    removeUserFromGroup: async (group, id) => {
      calls.removeUserFromGroup.push({ group, id });
      if (overrides.removeUserFromGroupFails) {
        return err(
          overrides.removeUserFromGroupFails.code,
          overrides.removeUserFromGroupFails.message,
        );
      }
      return ok(undefined);
    },

    listUserGroups: async (id) => {
      calls.listUserGroups.push(id);
      return ok([]);
    },
  };
};
