import { describe, expect, it } from "vitest";
import {
  appointmentNotificationMessage,
  formatIqdAmount,
  thankYouNotificationMessage,
} from "./notification-messages";

describe("formatIqdAmount", () => {
  it("formats whole amounts with thousands separators", () => {
    expect(formatIqdAmount(341000)).toBe("341,000");
    expect(formatIqdAmount("250000.00")).toBe("250,000");
    expect(formatIqdAmount(0)).toBe("0");
  });
});

describe("appointmentNotificationMessage", () => {
  const base = {
    companyName: "رياح والأقواس",
    mallName: "شكار مول",
    amount: 341000,
    // 10:00 in Baghdad.
    scheduledAt: new Date("2026-11-09T07:00:00.000Z"),
  };

  it("matches the owner's dictated template", () => {
    expect(appointmentNotificationMessage(base)).toBe(
      [
        "السلام عليكم،",
        "تم تحديد موعد استلام مستحقاتكم المالية:",
        "🏢 *الشركة:* رياح والأقواس",
        "🏬 *المول:* شكار مول",
        "📅 *التاريخ:* 09/11/2026",
        "🕙 *الوقت:* 10:00 صباحاً",
        "━━━━━━━━━━━━━━",
        "🔹 يرجى الالتزام بالموعد، وفي حال التأخير يتم تأجيل الاستلام إلى يوم آخر يحدده المحاسب مباشرةً.",
        "🔹 يرجى مطابقة الحساب مع محاسب المول والتأكد من المبلغ وعدّه قبل المغادرة.",
        "🔹 بعد مغادرة المحاسب، لا يتحمل أي مسؤولية عن النقص.",
        "⚠️ هذه رسالة تلقائية، ورقم الواتساب لا يستقبل الردود أو الاتصالات. يرجى عدم الرد.",
        "*شكراً لتعاونكم.*",
      ].join("\n"),
    );
  });

  it("formats afternoon Baghdad times with مساءً", () => {
    const message = appointmentNotificationMessage({
      ...base,
      // 13:30 in Baghdad.
      scheduledAt: new Date("2026-11-09T10:30:00.000Z"),
    });
    expect(message).toContain("📅 *التاريخ:* 09/11/2026");
    expect(message).toContain("🕙 *الوقت:* 1:30 مساءً");
  });

  it("omits the mall line without a mall and never includes amount or note", () => {
    const message = appointmentNotificationMessage({
      ...base,
      mallName: null,
      note: "ملاحظة داخلية",
    });
    expect(message).not.toContain("🏬");
    expect(message).not.toContain("341");
    expect(message).not.toContain("ملاحظة داخلية");
  });
});

describe("thankYouNotificationMessage", () => {
  it("matches the owner's dictated wording in the mall's name", () => {
    expect(
      thankYouNotificationMessage({
        companyName: "الرياح القواس",
        mallName: "باريس مول فرع 1",
      }),
    ).toBe(
      [
        "شكراً لتعاونكم مع باريس مول فرع 1 🌹",
        "تم استلام مبلغ طلبكم بالكامل.",
        "الشركة: الرياح القواس",
        "نتمنى لكم دوام التوفيق",
      ].join("\n"),
    );
  });

  it("appends the payment note as a final line when present", () => {
    const lines = thankYouNotificationMessage({
      companyName: "الرياح القواس",
      mallName: "باريس مول فرع 1",
      note: "تم الاستلام نقداً",
    }).split("\n");
    expect(lines[lines.length - 1]).toBe("ملاحظة: تم الاستلام نقداً");
  });
});
