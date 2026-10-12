import { describe, expect, it } from "vitest";
import { payloadFingerprint } from "./idempotency";

describe("payload fingerprints", () => {
  it("is stable for the same payload and changes with relevant data", () => {
    const original = { type: "request-v1", companyId: "c1", amount: "10.00" };
    expect(payloadFingerprint(original)).toBe(payloadFingerprint(original));
    expect(payloadFingerprint({ ...original, amount: "11.00" })).not.toBe(
      payloadFingerprint(original),
    );
  });
});
