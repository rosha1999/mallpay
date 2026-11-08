import { describe, expect, it } from "vitest";
import {
  isRetryableOpenWaError,
  OpenWaRequestError,
  openWaChatId,
  openWaConfig,
  openWaProviderMessageId,
  pickOpenWaSessionId,
} from "./openwa";

const KEY = "k".repeat(40);
const BASE = "https://example-tunnel.trycloudflare.com";

describe("OpenWA configuration", () => {
  it("rejects missing or weak configuration", () => {
    expect(openWaConfig({})).toBeNull();
    expect(openWaConfig({ OPENWA_BASE_URL: BASE })).toBeNull();
    expect(openWaConfig({ OPENWA_API_KEY: KEY })).toBeNull();
    expect(
      openWaConfig({ OPENWA_BASE_URL: BASE, OPENWA_API_KEY: "short" }),
    ).toBeNull();
    expect(
      openWaConfig({ OPENWA_BASE_URL: "not a url", OPENWA_API_KEY: KEY }),
    ).toBeNull();
  });

  it("rejects plain HTTP outside localhost and URLs with credentials", () => {
    expect(
      openWaConfig({
        OPENWA_BASE_URL: "http://example.com:2785",
        OPENWA_API_KEY: KEY,
      }),
    ).toBeNull();
    expect(
      openWaConfig({
        OPENWA_BASE_URL: "https://user:pass@example.com",
        OPENWA_API_KEY: KEY,
      }),
    ).toBeNull();
    expect(
      openWaConfig({
        OPENWA_BASE_URL: "http://localhost:2785",
        OPENWA_API_KEY: KEY,
      }),
    ).not.toBeNull();
  });

  it("normalizes the base URL and defaults the session name", () => {
    expect(openWaConfig({ OPENWA_BASE_URL: `${BASE}/`, OPENWA_API_KEY: KEY })).toEqual({
      baseUrl: BASE,
      apiKey: KEY,
      sessionName: "mallpay",
    });
    expect(
      openWaConfig({
        OPENWA_BASE_URL: BASE,
        OPENWA_API_KEY: KEY,
        OPENWA_SESSION_NAME: "shop_1",
      })?.sessionName,
    ).toBe("shop_1");
    expect(
      openWaConfig({
        OPENWA_BASE_URL: BASE,
        OPENWA_API_KEY: KEY,
        OPENWA_SESSION_NAME: "bad name!",
      }),
    ).toBeNull();
  });
});

describe("OpenWA helpers", () => {
  it("builds a chat id from international digits", () => {
    expect(openWaChatId("9647722616861")).toBe("9647722616861@c.us");
  });

  it("picks the session id by name from list payloads", () => {
    expect(
      pickOpenWaSessionId(
        [
          { id: "a", name: "other" },
          { id: "b", name: "mallpay" },
        ],
        "mallpay",
      ),
    ).toBe("b");
    expect(pickOpenWaSessionId({ data: [{ id: "c", name: "mallpay" }] }, "mallpay")).toBe("c");
    expect(pickOpenWaSessionId([{ id: "a", name: "other" }], "mallpay")).toBeNull();
    expect(pickOpenWaSessionId(null, "mallpay")).toBeNull();
  });

  it("extracts provider message ids from send payloads", () => {
    expect(openWaProviderMessageId({ id: "wamid.1" })).toBe("wamid.1");
    expect(openWaProviderMessageId({ id: { _serialized: "true_1@c.us_X" } })).toBe(
      "true_1@c.us_X",
    );
    expect(openWaProviderMessageId({ messageId: "m-2" })).toBe("m-2");
    expect(openWaProviderMessageId({})).toBeNull();
    expect(openWaProviderMessageId(null)).toBeNull();
  });
});

describe("OpenWA error classification", () => {
  it("treats network failures and gateway-side errors as retryable", () => {
    expect(
      isRetryableOpenWaError(
        new OpenWaRequestError("OpenWA request failed: fetch failed", null),
      ),
    ).toBe(true);
    expect(isRetryableOpenWaError(new OpenWaRequestError("OpenWA HTTP 502", 502))).toBe(
      true,
    );
    expect(isRetryableOpenWaError(new OpenWaRequestError("OpenWA HTTP 429", 429))).toBe(
      true,
    );
    expect(
      isRetryableOpenWaError(
        new OpenWaRequestError("OpenWA HTTP 404: Session not found", 404),
      ),
    ).toBe(true);
  });

  it("treats an inactive session as retryable", () => {
    expect(
      isRetryableOpenWaError(
        new OpenWaRequestError(
          "OpenWA HTTP 400: Session 'sess-1' is not active. Start the session first.",
          400,
        ),
      ),
    ).toBe(true);
  });

  it("treats other client errors and unknown errors as final", () => {
    expect(
      isRetryableOpenWaError(
        new OpenWaRequestError("OpenWA HTTP 400: Invalid chat id", 400),
      ),
    ).toBe(false);
    expect(
      isRetryableOpenWaError(
        new OpenWaRequestError("OpenWA HTTP 401: Invalid API key", 401),
      ),
    ).toBe(false);
    expect(isRetryableOpenWaError(new Error("boom"))).toBe(false);
  });
});
