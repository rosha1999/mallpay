import { emailApiConfig } from "@/lib/email";
import { isConfiguredSecret } from "@/lib/secrets";
import { whatsappApiConfig } from "@/lib/whatsapp";

function isPostgresUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function productionConfigIssues(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const issues: string[] = [];
  if (!isPostgresUrl(env.DATABASE_URL)) issues.push("DATABASE_URL");
  if (!isPostgresUrl(env.DIRECT_URL)) issues.push("DIRECT_URL");
  if (!isConfiguredSecret(env.AUTH_SECRET)) issues.push("AUTH_SECRET");
  if (!isConfiguredSecret(env.NOTIFICATION_CRON_SECRET))
    issues.push("NOTIFICATION_CRON_SECRET");

  try {
    const appUrl = new URL(env.APP_URL ?? "");
    if (
      appUrl.protocol !== "https:" ||
      appUrl.username ||
      appUrl.password ||
      appUrl.pathname !== "/" ||
      appUrl.search ||
      appUrl.hash
    )
      issues.push("APP_URL must be an HTTPS origin");
  } catch {
    issues.push("APP_URL must be an HTTPS origin");
  }

  if (!whatsappApiConfig(env)) issues.push("WhatsApp API credentials");
  if (!env.WHATSAPP_TEMPLATE_NAME?.trim())
    issues.push("WHATSAPP_TEMPLATE_NAME (approved Meta template)");
  if (!isConfiguredSecret(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN))
    issues.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  if (!isConfiguredSecret(env.WHATSAPP_APP_SECRET))
    issues.push("WHATSAPP_APP_SECRET");
  if (!emailApiConfig(env)) issues.push("EMAIL_API_KEY and EMAIL_FROM");
  return issues;
}
