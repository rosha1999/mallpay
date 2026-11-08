// Customer-facing notification texts. The appointment message wording was
// dictated by the owner (2026-11-08): it names the company and mall and
// splits the appointment into a date line and a time line; the amount and
// the admin's schedule note are intentionally NOT part of the customer
// text. The thank-you message is sent once, when a request's amount is
// received in full, and speaks in the mall's name — its wording was also
// dictated by the owner.

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

function baghdadDateAndTime(date: Date): { date: string; time: string } {
  const parts = new Map(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Baghdad",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const hour24 = Number(parts.get("hour") ?? "0");
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    date: `${parts.get("day")}/${parts.get("month")}/${parts.get("year")}`,
    time: `${hour12}:${parts.get("minute")} ${hour24 < 12 ? "صباحاً" : "مساءً"}`,
  };
}

export function appointmentNotificationMessage(
  input: AppointmentMessageInput,
): string {
  const { date, time } = baghdadDateAndTime(input.scheduledAt);
  const lines = [
    "السلام عليكم،",
    "تم تحديد موعد استلام مستحقاتكم المالية:",
    `🏢 *الشركة:* ${input.companyName}`,
  ];
  if (input.mallName) lines.push(`🏬 *المول:* ${input.mallName}`);
  lines.push(
    `📅 *التاريخ:* ${date}`,
    `🕙 *الوقت:* ${time}`,
    "━━━━━━━━━━━━━━",
    "🔹 يرجى الالتزام بالموعد، وفي حال التأخير يتم تأجيل الاستلام إلى يوم آخر يحدده المحاسب مباشرةً.",
    "🔹 يرجى مطابقة الحساب مع محاسب المول والتأكد من المبلغ وعدّه قبل المغادرة.",
    "🔹 بعد مغادرة المحاسب، لا يتحمل أي مسؤولية عن النقص.",
    "⚠️ هذه رسالة تلقائية، ورقم الواتساب لا يستقبل الردود أو الاتصالات. يرجى عدم الرد.",
    "*شكراً لتعاونكم.*",
  );
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
