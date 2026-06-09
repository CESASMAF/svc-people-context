import { describe, it, expect } from "bun:test";
import { validateCreatePerson, validateUpdatePerson } from "../../src/domain/person.ts";

const expectOk = (result: { kind: string }) => {
  expect(result.kind).toBe("ok");
};
const expectError = (result: { kind: string; message?: string }, msg: string) => {
  expect(result.kind).toBe("error");
  expect((result as { message: string }).message).toBe(msg);
};

describe("validateCreatePerson", () => {
  const valid = { fullName: "Ana Costa", birthDate: "1990-05-15" };

  it("accepts valid input without cpf", () => {
    expectOk(validateCreatePerson(valid));
  });

  it("accepts valid input with cpf", () => {
    expectOk(validateCreatePerson({ ...valid, cpf: "52998224725" }));
  });

  it("rejects empty fullName", () => {
    expectError(validateCreatePerson({ ...valid, fullName: "" }), "fullName is required");
  });

  it("rejects whitespace-only fullName", () => {
    expectError(validateCreatePerson({ ...valid, fullName: "   " }), "fullName is required");
  });

  it("rejects fullName over 200 characters", () => {
    expectError(
      validateCreatePerson({ ...valid, fullName: "A".repeat(201) }),
      "fullName must be at most 200 characters",
    );
  });

  it("accepts fullName with exactly 200 characters", () => {
    expectOk(validateCreatePerson({ ...valid, fullName: "A".repeat(200) }));
  });

  it("rejects cpf with less than 11 digits", () => {
    expectError(
      validateCreatePerson({ ...valid, cpf: "1234567890" }),
      "cpf must be exactly 11 digits with valid check digits",
    );
  });

  it("rejects cpf with more than 11 digits", () => {
    expectError(
      validateCreatePerson({ ...valid, cpf: "123456789012" }),
      "cpf must be exactly 11 digits with valid check digits",
    );
  });

  it("rejects cpf with non-digit characters", () => {
    expectError(
      validateCreatePerson({ ...valid, cpf: "1234567890a" }),
      "cpf must be exactly 11 digits with valid check digits",
    );
  });

  it("rejects cpf with all same digits (e.g. 11111111111)", () => {
    expectError(
      validateCreatePerson({ ...valid, cpf: "11111111111" }),
      "cpf must be exactly 11 digits with valid check digits",
    );
  });

  it("rejects cpf with invalid check digits", () => {
    expectError(
      validateCreatePerson({ ...valid, cpf: "12345678900" }),
      "cpf must be exactly 11 digits with valid check digits",
    );
  });

  it("accepts cpf with valid check digits (52998224725)", () => {
    expectOk(validateCreatePerson({ ...valid, cpf: "52998224725" }));
  });

  it("accepts cpf with valid check digits (12345678909)", () => {
    expectOk(validateCreatePerson({ ...valid, cpf: "12345678909" }));
  });

  it("rejects empty birthDate", () => {
    expectError(validateCreatePerson({ ...valid, birthDate: "" }), "birthDate is required");
  });

  it("rejects invalid birthDate format", () => {
    expectError(
      validateCreatePerson({ ...valid, birthDate: "not-a-date" }),
      "birthDate must be YYYY-MM-DD format",
    );
  });

  it("rejects future birthDate", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const futureStr = future.toISOString().split("T")[0]!;
    expectError(
      validateCreatePerson({ ...valid, birthDate: futureStr }),
      "birthDate cannot be in the future",
    );
  });

  it("accepts today as birthDate", () => {
    const today = new Date().toISOString().split("T")[0]!;
    expectOk(validateCreatePerson({ ...valid, birthDate: today }));
  });
});

describe("validateUpdatePerson", () => {
  it("delegates to validateCreatePerson", () => {
    expectError(
      validateUpdatePerson({ fullName: "", birthDate: "2000-01-01" }),
      "fullName is required",
    );
    expectOk(validateUpdatePerson({ fullName: "João", birthDate: "2000-01-01" }));
  });
});
