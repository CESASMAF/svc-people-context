import type { PersonRepository } from "../../src/repository/person-repository.ts";
import type { RoleRepository } from "../../src/repository/role-repository.ts";
import type { Person } from "../../src/domain/person.ts";
import type { SystemRole } from "../../src/domain/system-role.ts";

export const createFakePersonRepository = (): PersonRepository & {
  readonly _store: Map<string, Person>;
} => {
  const store = new Map<string, Person>();

  return {
    _store: store,

    create: async (input) => {
      const person: Person = {
        id: crypto.randomUUID(),
        fullName: input.fullName,
        cpf: input.cpf ?? null,
        birthDate: input.birthDate,
        email: input.email ?? null,
        idpUserId: null,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(person.id, person);
      return person;
    },

    findById: async (id) => store.get(id) ?? null,

    findByCpf: async (cpf) => {
      for (const p of store.values()) {
        if (p.cpf === cpf) return p;
      }
      return null;
    },

    update: async (id, input) => {
      const existing = store.get(id);
      if (!existing) return null;
      const updated: Person = {
        ...existing,
        fullName: input.fullName,
        cpf: input.cpf ?? null,
        birthDate: input.birthDate,
        // COALESCE: preserva email atual quando o update nao informa email.
        email: input.email ?? existing.email,
        updatedAt: new Date().toISOString(),
      };
      store.set(id, updated);
      return updated;
    },

    setIdpUserId: async (id, idpUserId, email) => {
      const existing = store.get(id);
      if (!existing) return null;
      const updated: Person = {
        ...existing,
        idpUserId,
        email,
        updatedAt: new Date().toISOString(),
      };
      store.set(id, updated);
      return updated;
    },

    deactivate: async (id) => {
      const existing = store.get(id);
      if (!existing?.active) return null;
      const updated: Person = { ...existing, active: false, updatedAt: new Date().toISOString() };
      store.set(id, updated);
      return updated;
    },

    reactivate: async (id) => {
      const existing = store.get(id);
      if (!existing || existing.active) return null;
      const updated: Person = { ...existing, active: true, updatedAt: new Date().toISOString() };
      store.set(id, updated);
      return updated;
    },

    remove: async (id) => store.delete(id),

    listWithIdpUser: async () => [...store.values()].filter((p) => p.idpUserId !== null),

    list: async (options = {}) => {
      let items = [...store.values()];
      const search = options.search?.trim().toLowerCase();
      if (search) {
        items = items.filter(
          (p) => p.fullName.toLowerCase().includes(search) || (p.cpf?.startsWith(search) ?? false),
        );
      }
      const limit = Math.min(options.limit ?? 20, 100);
      const data = items.slice(0, limit);
      return {
        data,
        totalCount: items.length,
        hasMore: items.length > limit,
        nextCursor: null,
      };
    },
  };
};

export const createFakeRoleRepository = (): RoleRepository & {
  readonly _store: Map<string, SystemRole>;
} => {
  const store = new Map<string, SystemRole>();

  return {
    _store: store,

    assign: async (personId, input) => {
      for (const r of store.values()) {
        if (r.personId === personId && r.system === input.system && r.role === input.role) {
          if (r.active) return { role: r, created: false };
          const reactivated = { ...r, active: true };
          store.set(r.id, reactivated);
          return { role: reactivated, created: true };
        }
      }
      const role: SystemRole = {
        id: crypto.randomUUID(),
        personId,
        system: input.system,
        role: input.role,
        active: true,
        assignedAt: new Date().toISOString(),
      };
      store.set(role.id, role);
      return { role, created: true };
    },

    findById: async (personId, roleId) => {
      const role = store.get(roleId);
      if (role?.personId !== personId) return null;
      return role;
    },

    listByPerson: async (personId, active) => {
      const roles = [...store.values()].filter((r) => r.personId === personId);
      if (active !== undefined) return roles.filter((r) => r.active === active);
      return roles;
    },

    deactivate: async (personId, roleId) => {
      const role = store.get(roleId);
      if (role?.personId !== personId || !role.active) return null;
      const deactivated = { ...role, active: false };
      store.set(roleId, deactivated);
      return deactivated;
    },

    reactivate: async (personId, roleId) => {
      const role = store.get(roleId);
      if (role?.personId !== personId || role.active) return null;
      const reactivated = { ...role, active: true };
      store.set(roleId, reactivated);
      return reactivated;
    },

    query: async (system, role, active = true) => {
      const roles = [...store.values()].filter(
        (r) => r.system === system && r.active === active && (!role || r.role === role),
      );
      return roles.map((r) => ({
        person: { id: r.personId, fullName: "Test", cpf: null, birthDate: "2000-01-01" },
        role: r,
      }));
    },
  };
};
