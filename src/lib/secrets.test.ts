import { describe, expect, it } from "vitest";
import { isConfiguredSecret } from "./secrets";

describe("secret configuration", () => {
  it("rejects empty, short, and example secrets", () => {
    expect(isConfiguredSecret(undefined)).toBe(false);
    expect(isConfiguredSecret("short")).toBe(false);
    expect(isConfiguredSecret("replace-with-a-long-random-secret")).toBe(false);
  });

  it("accepts a unique value of sufficient length", () => {
    expect(
      isConfiguredSecret("0b4d2ce7-unique-test-secret-material-123456"),
    ).toBe(true);
  });
});
