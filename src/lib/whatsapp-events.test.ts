import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseWhatsAppEventTime,
  verifyWhatsAppWebhookSignature,
  whatsappStatusEventKey,
} from "./whatsapp-events";

describe("WhatsApp webhook handling", () => {
  it("rejects short secrets even when their signatures match", () => {
    const body = new TextEncoder().encode("{}");
    const secret = "short";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyWhatsAppWebhookSignature(body, signature, secret)).toBe(false);
  });

  it("accepts signatures only for a configured secret and exact body", () => {
    const body = new TextEncoder().encode("{\"status\":\"read\"}");
    const secret = "a".repeat(40);
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyWhatsAppWebhookSignature(body, signature, secret)).toBe(true);
    expect(
      verifyWhatsAppWebhookSignature(new TextEncoder().encode("{}"), signature, secret),
    ).toBe(false);
  });

  it("parses provider epochs and safely falls back for malformed values", () => {
    expect(parseWhatsAppEventTime("1760000000").toISOString()).toBe(
      "2025-10-09T08:53:20.000Z",
    );
    const fallback = new Date("2026-01-01T00:00:00.000Z");
    expect(parseWhatsAppEventTime("invalid", fallback)).toBe(fallback);
  });

  it("deduplicates equivalent provider events deterministically", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    expect(whatsappStatusEventKey("wamid.1", "READ", at, null)).toBe(
      whatsappStatusEventKey("wamid.1", "READ", at, null),
    );
    expect(whatsappStatusEventKey("wamid.1", "READ", at, null)).not.toBe(
      whatsappStatusEventKey("wamid.1", "DELIVERED", at, null),
    );
  });
});
