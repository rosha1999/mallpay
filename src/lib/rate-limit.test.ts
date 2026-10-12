import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { clientIdentifier } from "./rate-limit";

const originalHeader = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;

afterEach(() => {
  if (originalHeader === undefined)
    delete process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  else process.env.RATE_LIMIT_TRUSTED_IP_HEADER = originalHeader;
});

describe("trusted client IP extraction", () => {
  it("ignores forwarding headers unless the trusted ingress is configured", () => {
    delete process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
    const request = new NextRequest("https://mallpay.example/api", {
      headers: {
        "x-real-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.20",
      },
    });
    expect(clientIdentifier(request)).toBeNull();
  });

  it("uses only a valid configured x-real-ip header", () => {
    process.env.RATE_LIMIT_TRUSTED_IP_HEADER = "x-real-ip";
    const trusted = new NextRequest("https://mallpay.example/api", {
      headers: { "x-real-ip": "203.0.113.10" },
    });
    const spoofOnly = new NextRequest("https://mallpay.example/api", {
      headers: { "x-forwarded-for": "198.51.100.20" },
    });
    expect(clientIdentifier(trusted)).toMatch(/^[a-f0-9]{64}$/);
    expect(clientIdentifier(spoofOnly)).toBeNull();
  });
});
