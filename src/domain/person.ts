// ─── Branded Types (smart constructors for type safety) ─────────

declare const PersonIdBrand: unique symbol;
export type PersonId = string & { readonly [PersonIdBrand]: typeof PersonIdBrand };
export const toPersonId = (value: string): PersonId => value as PersonId;

declare const CpfBrand: unique symbol;
export type Cpf = string & { readonly [CpfBrand]: typeof CpfBrand };

const isValidCpfCheckDigits = (digits: string): boolean => {
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const sum1 = Array.from({ length: 9 }, (_, i) => Number(digits[i]) * (10 - i)).reduce(
    (a, b) => a + b,
    0,
  );
  const d1 = ((sum1 * 10) % 11) % 10;
  if (d1 !== Number(digits[9])) return false;

  const sum2 = Array.from({ length: 10 }, (_, i) => Number(digits[i]) * (11 - i)).reduce(
    (a, b) => a + b,
    0,
  );
  const d2 = ((sum2 * 10) % 11) % 10;
  return d2 === Number(digits[10]);
};

export const toCpf = (value: string): Cpf | null =>
  /^\d{11}$/.test(value) && isValidCpfCheckDigits(value) ? (value as Cpf) : null;

declare const IsoDateStr: unique symbol;
export type IsoDateString = string & { readonly [IsoDateStr]: typeof IsoDateStr };
export const toIsoDate = (value: string): IsoDateString | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? (value as IsoDateString) : null;

// ─── Domain Types ───────────────────────────────────────────────

export interface Person {
  readonly id: string;
  readonly fullName: string;
  readonly cpf: string | null;
  readonly birthDate: string;
  readonly email: string | null;
  // IdP user identifiers (Authentik).
  // - `idpUserId`: o `uid` (hash hex64) que viaja no `sub` do JWT — actorId conforme ADR-023.
  // - `idpUserPk`: pk integer do Authentik usado em mutacoes da Management API
  //   (`/api/v3/core/users/{pk}/`). Filtro `?uid=` nao funciona no DRF — code-review HIGH-6.
  readonly idpUserId: string | null;
  readonly idpUserPk: number | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePersonInput {
  readonly fullName: string;
  readonly cpf?: string;
  readonly birthDate: string;
  readonly email?: string;
  readonly createLogin?: boolean;
  readonly initialPassword?: string;
}

export type UpdatePersonInput = CreatePersonInput;

// ─── Validation (discriminated union result) ────────────────────

export type ValidationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly message: string };

const ok = { kind: "ok" } as const satisfies ValidationResult;
const fail = (message: string): ValidationResult => ({ kind: "error", message });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateCreatePerson = (input: CreatePersonInput): ValidationResult => {
  if (input.fullName.trim().length === 0) return fail("fullName is required");
  if (input.fullName.length > 200) return fail("fullName must be at most 200 characters");
  if (input.cpf !== undefined && toCpf(input.cpf) === null)
    return fail("cpf must be exactly 11 digits with valid check digits");
  if (input.birthDate.length === 0) return fail("birthDate is required");
  if (toIsoDate(input.birthDate) === null) return fail("birthDate must be YYYY-MM-DD format");
  if (new Date(input.birthDate) > new Date()) return fail("birthDate cannot be in the future");
  if (input.email !== undefined && !EMAIL_RE.test(input.email))
    return fail("email must be a valid email address");
  if (input.createLogin === true && input.email === undefined)
    return fail("email is required when createLogin is true");
  return ok;
};

export const validateUpdatePerson = (input: UpdatePersonInput): ValidationResult =>
  validateCreatePerson(input);
