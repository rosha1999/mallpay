import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { readJsonBody, RequestBodyError, sameOriginError } from "./http";

describe("bounded JSON request parsing", () => {
  it("parses valid JSON", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    await expect(readJsonBody(request)).resolves.toEqual({ ok: true });
  });

  it("rejects unsupported content types", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 415 });
  });

  it("rejects oversized and malformed JSON bodies with the right status", async () => {
    const oversized = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"data":"larger"}',
    });
    await expect(readJsonBody(oversized, 8)).rejects.toMatchObject({
      status: 413,
    });

    const malformed = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array([0xff]),
    });
    await expect(readJsonBody(malformed)).rejects.toBeInstanceOf(
      RequestBodyError,
    );
  });
});

describe("same-origin mutation protection", () => {
  it("rejects requests without an Origin header", () => {
    const request = new NextRequest("https://mallpay.example/api/action", {
      method: "POST",
    });
    expect(sameOriginError(request)?.status).toBe(403);
  });

  it("rejects cross-origin browser mutations", () => {
    const request = new NextRequest("https://mallpay.example/api/action", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(sameOriginError(request)?.status).toBe(403);
  });

  it("accepts requests from the configured app origin", () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = "https://mallpay.example";
    const request = new NextRequest("https://mallpay.example/api/action", {
      method: "POST",
      headers: {
        origin: "https://mallpay.example",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(sameOriginError(request)).toBeNull();
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  });
});
