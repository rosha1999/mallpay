import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isConfiguredSecret } from "@/lib/secrets";
import { normalizePhoneNumber } from "@/lib/phone";
import { whatsappApiConfig, whatsappMessagePayload } from "@/lib/whatsapp";
import { applyPendingWhatsAppStatusEvents } from "@/lib/whatsapp-events";
import { emailApiConfig, sendNotificationEmail } from "@/lib/email";

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

  const whatsapp = whatsappApiConfig();
  const email = emailApiConfig();
  if (!whatsapp && !email)
    return NextResponse.json(
      { error: "إعدادات WhatsApp والبريد غير مكتملة؛ لم تُسحب أي إشعارات من قائمة الإرسال." },
      { status: 503, headers: { "Retry-After": "300" } },
    );

  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  const recovered = await prisma.notification.updateMany({
    where: { deliveryStatus: "PROCESSING", updatedAt: { lt: staleBefore } },
    data: {
      deliveryStatus: "FAILED",
      lastError:
        "Worker lease expired; verify the provider before manually retrying.",
    },
  });

  const queued = await prisma.notification.findMany({
    where: {
      deliveryStatus: "QUEUED",
      channel: { in: ["WHATSAPP", "EMAIL"] },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  let sent = 0,
    failed = 0,
    skipped = 0;
  for (const n of queued) {
    if (n.channel === "IN_APP") {
      skipped++;
      continue;
    }
    if ((n.channel === "WHATSAPP" && !whatsapp) || (n.channel === "EMAIL" && !email)) {
      skipped++;
      continue;
    }
    // Atomically claim each notification so concurrent worker invocations cannot send it twice.
    const claim = await prisma.notification.updateMany({
      where: { id: n.id, deliveryStatus: "QUEUED" },
      data: { deliveryStatus: "PROCESSING", attempts: { increment: 1 } },
    });
    if (claim.count !== 1) {
      skipped++;
      continue;
    }
    const recipient =
      n.channel === "WHATSAPP"
        ? n.recipient
          ? normalizePhoneNumber(n.recipient)
          : null
        : n.recipient?.trim() || null;
    if (!recipient) {
      await prisma.notification.update({
        where: { id: n.id },
        data: {
          deliveryStatus: "FAILED",
          lastError: "Missing or invalid international recipient phone",
        },
      });
      failed++;
      continue;
    }
    let messageRecorded = false;
    try {
      let providerMessageId: string | null;
      if (n.channel === "EMAIL") {
        providerMessageId = await sendNotificationEmail(email!, recipient, n.message);
      } else {
        const response = await fetch(
          `https://graph.facebook.com/${whatsapp!.apiVersion}/${whatsapp!.phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${whatsapp!.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              whatsappMessagePayload(whatsapp!, recipient, n.message),
            ),
            cache: "no-store",
            signal: AbortSignal.timeout(20_000),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            typeof data?.error?.message === "string"
              ? data.error.message
              : `WhatsApp HTTP ${response.status}`,
          );
        providerMessageId =
          typeof data?.messages?.[0]?.id === "string"
            ? data.messages[0].id
            : null;
      }
      if (!providerMessageId)
        throw new Error("Notification provider response did not include a message ID");
      const stored = await prisma.notification.updateMany({
        where: { id: n.id, deliveryStatus: "PROCESSING" },
        data: {
          deliveryStatus: "SENT",
          providerMessageId,
          sentAt: new Date(),
          lastError: null,
        },
      });
      if (stored.count !== 1)
        throw new Error("Notification lease was lost after provider accepted the send");
      messageRecorded = true;
      sent++;
      if (n.channel === "WHATSAPP") {
        await prisma.$transaction((tx) =>
          applyPendingWhatsAppStatusEvents(tx, providerMessageId!),
        );
      }
    } catch (e) {
      if (messageRecorded) {
        skipped++;
        continue;
      }
      await prisma.notification.updateMany({
        where: { id: n.id, deliveryStatus: "PROCESSING" },
        data: {
          deliveryStatus: "FAILED",
          lastError:
            e instanceof Error ? e.message.slice(0, 500) : "Unknown send error",
        },
      });
      failed++;
    }
  }
  return NextResponse.json({
    processed: queued.length,
    sent,
    failed,
    skipped,
    recovered: recovered.count,
  });
}
