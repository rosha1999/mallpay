import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isConfiguredSecret } from "@/lib/secrets";
import { runNotificationDispatch } from "@/lib/notification-dispatch";

// Invoke from a trusted scheduler using Authorization: Bearer NOTIFICATION_CRON_SECRET.
export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFICATION_CRON_SECRET;
  const authorization = req.headers.get("authorization") ?? "";
  const supplied = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (
    !isConfiguredSecret(secret) ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const summary = await runNotificationDispatch();
  if (!summary.providersConfigured)
    return NextResponse.json(
      { error: "إعدادات WhatsApp والبريد غير مكتملة؛ لم تُسحب أي إشعارات من قائمة الإرسال." },
      { status: 503, headers: { "Retry-After": "300" } },
    );
  return NextResponse.json({
    processed: summary.processed,
    sent: summary.sent,
    failed: summary.failed,
    skipped: summary.skipped,
    recovered: summary.recovered,
  });
}
