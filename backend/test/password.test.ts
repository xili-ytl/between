import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/security/password.js";

describe("password hashing", () => {
  it("does not store the source password and verifies only the right value", async () => {
    const encoded = await hashPassword("owner supplied password");

    expect(encoded).not.toContain("owner supplied password");
    await expect(verifyPassword("owner supplied password", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong", encoded)).resolves.toBe(false);
  });

  it("rejects malformed encoded values", async () => {
    await expect(verifyPassword("anything", "not-a-password-hash")).resolves.toBe(false);
  });
});
