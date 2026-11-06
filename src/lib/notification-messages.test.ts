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
    companyName: "الرياح القواس",
    mallName: "باريس مول فرع 1",
    amount: 341000,
    scheduledAt: new Date("2026-11-20T07:00:00.000Z"),
  };

  it("names the company, mall, amount and time without the internal reference", () => {
    const lines = appointmentNotificationMessage(base).split("\n");
    expect(lines[0]).toBe("تم تحديد موعد استلام طلبكم لدى MallPay");
    expect(lines[1]).toBe("الشركة: الرياح القواس");
    expect(lines[2]).toBe("المول: باريس مول فرع 1");
    expect(lines[3]).toBe("المبلغ: 341,000 د.ع");
    expect(lines[4]).toMatch(/^الموعد: /);
    expect(lines).toHaveLength(5);
  });

  it("appends the admin note only when one was written", () => {
    const withNote = appointmentNotificationMessage({
      ...base,
      note: "  شفه تيسته  ",
    }).split("\n");
    expect(withNote[withNote.length - 1]).toBe("ملاحظة: شفه تيسته");
    const withoutMall = appointmentNotificationMessage({
      ...base,
      mallName: null,
      note: "   ",
    }).split("\n");
    expect(withoutMall.some((line) => line.startsWith("المول:"))).toBe(false);
    expect(withoutMall.some((line) => line.startsWith("ملاحظة:"))).toBe(false);
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
