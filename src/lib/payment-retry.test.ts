import { describe, expect, it } from "vitest";
import { shouldRotatePaymentKey } from "./payment-retry";

describe("payment retry keys", () => {
  it("preserves the key when the result is ambiguous", () => {
    expect(shouldRotatePaymentKey(409, "RETRY_SAME_KEY")).toBe(false);
    expect(shouldRotatePaymentKey(409, "IDEMPOTENCY_KEY_MISMATCH")).toBe(
      false,
    );
    expect(shouldRotatePaymentKey(429, undefined)).toBe(false);
    expect(shouldRotatePaymentKey(503, undefined)).toBe(false);
  });

  it("allows a new key after a definite client-side rejection", () => {
    expect(shouldRotatePaymentKey(400, undefined)).toBe(true);
    expect(shouldRotatePaymentKey(409, undefined)).toBe(true);
  });
});
