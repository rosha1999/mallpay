import { z } from "zod";

const MAX_AMOUNT_CENTS = 99_999_999_999_999n;

export function toCents(value: unknown): bigint | null {
  const raw = value === null || value === undefined ? "" : String(value);
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return null;

  const cents =
    BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return cents > 0n && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

export function fromCents(cents: bigint): string {
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function remainingBalanceCents(
  amount: unknown,
  payments: unknown[],
): bigint | null {
  const total = toCents(amount);
  if (total === null) return null;

  let paid = 0n;
  for (const payment of payments) {
    const cents = toCents(payment);
    if (cents === null) return null;
    paid += cents;
  }
  return total > paid ? total - paid : 0n;
}

export const moneyAmountSchema = z
  .union([z.number().finite(), z.string().max(15)])
  .transform((value) => {
    const cents = toCents(value);
    return cents === null ? null : fromCents(cents);
  })
  .refine((value): value is string => value !== null, {
    message: "أدخل مبلغاً موجباً بدقتين عشريتين كحد أقصى",
  });
