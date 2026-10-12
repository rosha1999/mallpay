import { z } from "zod";

function asciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.codePointAt(0)!;
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function normalizePhoneNumber(value: string): string | null {
  const compact = asciiDigits(value.trim()).replace(/[\s()-]/g, "");
  if (/^07\d{8,9}$/.test(compact)) return `964${compact.slice(1)}`;
  if (/^9647\d{8,9}$/.test(compact)) return compact;
  if (/^\+[1-9]\d{6,14}$/.test(compact)) return compact.slice(1);
  if (/^00[1-9]\d{6,14}$/.test(compact)) return compact.slice(2);
  return null;
}

export const phoneNumberSchema = z
  .string()
  .trim()
  .transform(normalizePhoneNumber)
  .refine((value): value is string => value !== null, {
    message: "استخدم رقماً عراقياً يبدأ بـ07 أو رقماً دولياً مع رمز الدولة",
  });
