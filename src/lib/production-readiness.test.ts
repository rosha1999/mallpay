import { describe, expect, it } from "vitest";
import { productionConfigIssues } from "./production-readiness";

const readyEnvironment = {
  DATABASE_URL: "postgresql://user:pass@db.example.com/mallpay",
  DIRECT_URL: "postgresql://user:pass@db.example.com/mallpay",
  AUTH_SECRET: "a".repeat(40),
  NOTIFICATION_CRON_SECRET: "b".repeat(40),
  APP_URL: "https://mallpay.example.com",
  WHATSAPP_ACCESS_TOKEN: "c".repeat(40),
  WHATSAPP_PHONE_NUMBER_ID: "1234567890",
  WHATSAPP_API_VERSION: "v22.0",
  WHATSAPP_TEMPLATE_NAME: "mallpay_appointment",
  WHATSAPP_TEMPLATE_LANGUAGE: "ar_IQ",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "d".repeat(40),
  WHATSAPP_APP_SECRET: "e".repeat(40),
  EMAIL_API_KEY: "f".repeat(40),
  EMAIL_FROM: "MallPay <alerts@example.com>",
};

describe("production configuration preflight", () => {
  it("accepts a complete production environment without exposing secrets", () => {
    expect(productionConfigIssues(readyEnvironment)).toEqual([]);
  });

  it("reports missing settings by variable name only", () => {
    const issues = productionConfigIssues({
      ...readyEnvironment,
      APP_URL: "http://mallpay.example.com",
      AUTH_SECRET: "example",
      EMAIL_API_KEY: "",
    });
    expect(issues).toContain("AUTH_SECRET");
    expect(issues).toContain("EMAIL_API_KEY and EMAIL_FROM");
    expect(issues).toContain("APP_URL must be an HTTPS origin");
    expect(issues.join(" ")).not.toContain(readyEnvironment.WHATSAPP_ACCESS_TOKEN);
  });
});
