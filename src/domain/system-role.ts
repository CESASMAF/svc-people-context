// ─── Branded Types ───────────────────────────────────────────────

declare const RoleIdBrand: unique symbol;
export type RoleId = string & { readonly [RoleIdBrand]: typeof RoleIdBrand };
export const toRoleId = (value: string): RoleId => value as RoleId;

// ─── Known Systems & Roles (union types, not enums) ─────────────

export type KnownSystem = "social-care" | "queue-manager" | "therapies" | "timesheet";

export type KnownRole = "patient" | "professional" | "family-member" | "employee" | "therapist";

// ─── Domain Types ───────────────────────────────────────────────

export interface SystemRole {
  readonly id: string;
  readonly personId: string;
  readonly system: string;
  readonly role: string;
  readonly active: boolean;
  readonly assignedAt: string;
}

export interface AssignRoleInput {
  readonly system: string;
  readonly role: string;
}

// ─── Validation (discriminated union result) ────────────────────

export type ValidationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly message: string };

const ok = { kind: "ok" } as const satisfies ValidationResult;
const fail = (message: string): ValidationResult => ({ kind: "error", message });

export const validateAssignRole = (input: AssignRoleInput): ValidationResult => {
  if (input.system.trim().length === 0) return fail("system is required");
  if (input.role.trim().length === 0) return fail("role is required");
  return ok;
};
