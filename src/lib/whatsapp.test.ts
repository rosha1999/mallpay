import { describe, expect, it } from "vitest";
import { whatsappApiConfig, whatsappMessagePayload } from "./whatsapp";

describe("WhatsApp API configuration", () => {
  it("rejects missing credentials before notifications are claimed", () => {
    expect(whatsappApiConfig({})).toBeNull();
    expect(
      whatsappApiConfig({
        WHATSAPP_ACCESS_TOKEN: "replace-with-a-real-token-1234567890",
        WHATSAPP_PHONE_NUMBER_ID: "123456",
      }),
    ).toBeNull();
  });

  it("accepts a strong token and numeric phone ID", () => {
    expect(
      whatsappApiConfig({
        WHATSAPP_ACCESS_TOKEN: "x".repeat(40),
        WHATSAPP_PHONE_NUMBER_ID: "1234567890",
        WHATSAPP_API_VERSION: "v22.0",
      }),
    ).toEqual({
      accessToken: "x".repeat(40),
      phoneNumberId: "1234567890",
      apiVersion: "v22.0",
      template: null,
    });
  });

  it("uses a configured approved template with one body parameter", () => {
    const config = whatsappApiConfig({
      WHATSAPP_ACCESS_TOKEN: "x".repeat(40),
      WHATSAPP_PHONE_NUMBER_ID: "1234567890",
      WHATSAPP_TEMPLATE_NAME: "mallpay_appointment",
      WHATSAPP_TEMPLATE_LANGUAGE: "ar_IQ",
    });
    expect(config?.template).toEqual({
      name: "mallpay_appointment",
      language: "ar_IQ",
    });
    expect(
      whatsappMessagePayload(config!, "9647701234567", "موعد جديد"),
    ).toMatchObject({
      type: "template",
      template: {
        name: "mallpay_appointment",
        language: { code: "ar_IQ" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: "موعد جديد" }],
          },
        ],
      },
    });
  });
});
