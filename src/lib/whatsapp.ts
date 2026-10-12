import { isConfiguredSecret } from "@/lib/secrets";

export type WhatsAppApiConfig = {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  template: { name: string; language: string } | null;
};

export function whatsappApiConfig(
  env: Record<string, string | undefined> = process.env,
): WhatsAppApiConfig | null {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const apiVersion = env.WHATSAPP_API_VERSION || "v22.0";
  const templateName = env.WHATSAPP_TEMPLATE_NAME?.trim() || undefined;
  const templateLanguage = env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "ar";
  if (
    !isConfiguredSecret(accessToken) ||
    !phoneNumberId ||
    !/^\d+$/.test(phoneNumberId) ||
    !/^v\d+\.\d+$/.test(apiVersion) ||
    (templateName !== undefined &&
      (!/^[a-z0-9_]+$/.test(templateName) ||
        !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(templateLanguage)))
  )
    return null;
  return {
    accessToken,
    phoneNumberId,
    apiVersion,
    template: templateName
      ? { name: templateName, language: templateLanguage }
      : null,
  };
}

export function whatsappMessagePayload(
  config: WhatsAppApiConfig,
  recipient: string,
  message: string,
) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    ...(config.template
      ? {
          type: "template",
          template: {
            name: config.template.name,
            language: { code: config.template.language },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: message }],
              },
            ],
          },
        }
      : {
          type: "text",
          text: { preview_url: false, body: message },
        }),
  };
}
