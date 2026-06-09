import { describe, it, expect } from "bun:test";
import { validateAssignRole } from "../../src/domain/system-role.ts";

const expectOk = (result: { kind: string }) => {
  expect(result.kind).toBe("ok");
};
const expectError = (result: { kind: string; message?: string }, msg: string) => {
  expect(result.kind).toBe("error");
  expect((result as { message: string }).message).toBe(msg);
};

describe("validateAssignRole", () => {
  it("accepts valid input", () => {
    expectOk(validateAssignRole({ system: "social-care", role: "patient" }));
  });

  it("rejects empty system", () => {
    expectError(validateAssignRole({ system: "", role: "patient" }), "system is required");
  });

  it("rejects whitespace-only system", () => {
    expectError(validateAssignRole({ system: "   ", role: "patient" }), "system is required");
  });

  it("rejects empty role", () => {
    expectError(validateAssignRole({ system: "social-care", role: "" }), "role is required");
  });

  it("rejects whitespace-only role", () => {
    expectError(validateAssignRole({ system: "social-care", role: "   " }), "role is required");
  });
});
