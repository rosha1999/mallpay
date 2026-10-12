import { describe, expect, it } from "vitest";
import { fromCents, remainingBalanceCents, toCents } from "./money";

describe("money helpers", () => {
  it("converts decimal strings and JSON numbers to exact cents", () => {
    expect(toCents("0.10")).toBe(10n);
    expect(toCents(0.2)).toBe(20n);
    expect(toCents("1.05")).toBe(105n);
  });

  it("rejects invalid precision, zero, negative, and out-of-range amounts", () => {
    expect(toCents("1.005")).toBeNull();
    expect(toCents("0")).toBeNull();
    expect(toCents("-1")).toBeNull();
    expect(toCents("1000000000000")).toBeNull();
  });

  it("formats cents without floating-point arithmetic", () => {
    expect(fromCents(30n)).toBe("0.30");
    expect(fromCents(12345n)).toBe("123.45");
  });

  it("keeps remaining balances exact after partial payments", () => {
    const remaining = remainingBalanceCents("0.30", ["0.10", "0.10"]);
    expect(remaining).toBe(10n);
    expect(fromCents(remaining!)).toBe("0.10");
  });
});
