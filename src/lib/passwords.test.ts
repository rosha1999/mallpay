import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { verifyAdminPassword } from "./passwords";

describe("admin password verification", () => {
  it("performs a dummy comparison for unknown accounts without authenticating", async () => {
    await expect(verifyAdminPassword("any-password", null)).resolves.toBe(
      false,
    );
  });

  it("accepts only the password matching an active account hash", async () => {
    const hash = await bcrypt.hash("correct-password", 4);
    await expect(verifyAdminPassword("correct-password", hash)).resolves.toBe(
      true,
    );
    await expect(verifyAdminPassword("wrong-password", hash)).resolves.toBe(
      false,
    );
  });
});
