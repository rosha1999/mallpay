import { isConfiguredSecret } from "@/lib/secrets";

export type EmailApiConfig = { apiKey: string; from: string };

function emailAddress(value: string): string | null {
  const match = value.match(/<([^<>]+)>\s*$/);
  const address = (match?.[1] ?? value).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null;
}

export function emailApiConfig(
  env: Record<string, string | undefined> = process.env,
): EmailApiConfig | null {
  const apiKey = env.EMAIL_API_KEY;
  const from = env.EMAIL_FROM?.trim();
  if (!isConfiguredSecret(apiKey, 24) || !from || !emailAddress(from))
    return null;
  return { apiKey, from };
}

export async function sendNotificationEmail(
  config: EmailApiConfig,
  recipient: string,
  message: string,
): Promise<string> {
  if (!emailAddress(recipient)) throw new Error("Invalid email recipient");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [recipient],
      subject: "إشعار من MallPay",
      text: message,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof data?.message === "string"
        ? data.message
        : `Email provider HTTP ${response.status}`,
    );
  if (typeof data?.id !== "string")
    throw new Error("Email provider response did not include a message ID");
  return data.id;
}
