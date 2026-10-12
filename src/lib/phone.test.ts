import { describe, expect, it } from "vitest";
import { phoneNumberSchema } from "./phone";

describe("phone number validation", () => {
  it("normalizes Iraqi and international numbers for WhatsApp", () => {
    expect(phoneNumberSchema.parse("07 1234 56789")).toBe("9647123456789");
    expect(phoneNumberSchema.parse("٠٧١٢٣٤٥٦٧٨٩")).toBe("9647123456789");
    expect(phoneNumberSchema.parse("+964 (751) 234-5678")).toBe(
      "9647512345678",
    );
    expect(phoneNumberSchema.parse("0044 20 7946 0958")).toBe("442079460958");
  });

  it("rejects malformed prefixes and numbers outside international limits", () => {
    expect(phoneNumberSchema.safeParse("call me 12345678").success).toBe(false);
    expect(phoneNumberSchema.safeParse("123456").success).toBe(false);
    expect(phoneNumberSchema.safeParse("07+12345678").success).toBe(false);
    expect(phoneNumberSchema.safeParse("+964+7512345678").success).toBe(false);
    expect(phoneNumberSchema.safeParse("1234567890123456").success).toBe(
      false,
    );
  });
});
