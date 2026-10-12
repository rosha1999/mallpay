import { afterEach, describe, expect, it, vi } from "vitest";
import { emailApiConfig, sendNotificationEmail } from "./email";

afterEach(() => vi.unstubAllGlobals());

describe("email provider integration", () => {
  it("requires a real API key and valid sender", () => {
    expect(emailApiConfig({})).toBeNull();
    expect(
      emailApiConfig({
        EMAIL_API_KEY: "replace-with-your-email-api-key",
        EMAIL_FROM: "MallPay <alerts@example.com>",
      }),
    ).toBeNull();
    expect(
      emailApiConfig({
        EMAIL_API_KEY: "r".repeat(32),
        EMAIL_FROM: "MallPay <alerts@example.com>",
      }),
    ).toEqual({
      apiKey: "r".repeat(32),
      from: "MallPay <alerts@example.com>",
    });
  });

  it("sends plain-text mail and returns the provider ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_123" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const id = await sendNotificationEmail(
      { apiKey: "r".repeat(32), from: "MallPay <alerts@example.com>" },
      "admin@example.com",
      "A new request arrived.",
    );
    expect(id).toBe("email_123");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: ["admin@example.com"],
      subject: "إشعار من MallPay",
      text: "A new request arrived.",
    });
  });

  it("rejects invalid recipients without calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendNotificationEmail(
        { apiKey: "r".repeat(32), from: "alerts@example.com" },
        "not-an-email",
        "test",
      ),
    ).rejects.toThrow("Invalid email recipient");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
