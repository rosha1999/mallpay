import { formatBaghdadDateTime } from "@/lib/dates";

// Customer-facing notification texts. The appointment message names the
// company, mall, amount and appointment time (plus the admin's note when
// present) instead of the internal request reference. The thank-you
// message is sent once, when a request's amount is received in full, and
// speaks in the mall's name — its wording was dictated by the owner.

export function formatIqdAmount(value: unknown): string {
  const numeric =
    typeof value === "number" ? value : Number(String(value ?? ""));
  if (!Number.isFinite(numeric)) return String(value ?? "");
  return Math.round(numeric).toLocaleString("en-US");
}

export type AppointmentMessageInput = {
  companyName: string;
  mallName: string | null;
  amount: unknown;
  scheduledAt: Date;
  note?: string | null;
};

export function appointmentNotificationMessage(
  input: AppointmentMessageInput,
): string {
  const lines = [
    "تم تحديد موعد استلام طلبكم لدى MallPay",
    `الشركة: ${input.companyName}`,
  ];
  if (input.mallName) lines.push(`المول: ${input.mallName}`);
  lines.push(`المبلغ: ${formatIqdAmount(input.amount)} د.ع`);
  lines.push(`الموعد: ${formatBaghdadDateTime(input.scheduledAt)}`);
  const note = input.note?.trim();
  if (note) lines.push(`ملاحظة: ${note}`);
  return lines.join("\n");
}

export type ThankYouMessageInput = {
  companyName: string;
  mallName: string;
  note?: string | null;
};

export function thankYouNotificationMessage(
  input: ThankYouMessageInput,
): string {
  const lines = [
    `شكراً لتعاونكم مع ${input.mallName} 🌹`,
    "تم استلام مبلغ طلبكم بالكامل.",
    `الشركة: ${input.companyName}`,
    "نتمنى لكم دوام التوفيق",
  ];
  const note = input.note?.trim();
  if (note) lines.push(`ملاحظة: ${note}`);
  return lines.join("\n");
}
