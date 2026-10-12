import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { DeliveryStatus, Prisma } from "@prisma/client";
import { isConfiguredSecret } from "@/lib/secrets";

export type WhatsAppEventStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

const statusRank: Record<DeliveryStatus, number> = {
  QUEUED: 0,
  PROCESSING: 0,
  SENT: 1,
  FAILED: 2,
  DELIVERED: 3,
  READ: 4,
};

export function parseWhatsAppEventTime(
  timestamp: string | undefined,
  fallback = new Date(),
): Date {
  if (!timestamp || !/^\d{1,13}$/.test(timestamp)) return fallback;
  const date = new Date(Number(timestamp) * 1000);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

export function whatsappStatusEventKey(
  providerMessageId: string,
  status: WhatsAppEventStatus,
  eventAt: Date,
  errorMessage: string | null,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        providerMessageId,
        status,
        eventAt.toISOString(),
        errorMessage,
      ]),
    )
    .digest("hex");
}

export function verifyWhatsAppWebhookSignature(
  rawBody: Uint8Array,
  signature: string | null,
  appSecret: string | undefined,
): boolean {
  if (
    !isConfiguredSecret(appSecret) ||
    !signature ||
    !/^sha256=[a-f0-9]{64}$/i.test(signature)
  )
    return false;

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const suppliedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

export async function applyPendingWhatsAppStatusEvents(
  tx: Prisma.TransactionClient,
  providerMessageId: string,
): Promise<number> {
  await tx.$queryRaw`
    SELECT "id" FROM "Notification"
    WHERE "providerMessageId" = ${providerMessageId}
    FOR UPDATE
  `;
  const notification = await tx.notification.findUnique({
    where: { providerMessageId },
  });
  if (!notification) return 0;

  const events = await tx.whatsAppStatusEvent.findMany({
    where: {
      providerMessageId,
      processedAt: null,
      status: { in: ["SENT", "DELIVERED", "READ", "FAILED"] },
    },
    orderBy: [{ eventAt: "asc" }, { createdAt: "asc" }],
  });
  if (!events.length) return 0;

  let deliveryStatus = notification.deliveryStatus;
  let deliveredAt = notification.deliveredAt;
  let readAt = notification.readAt;
  let lastError = notification.lastError;
  for (const event of events) {
    if (
      event.status === "DELIVERED" &&
      (!deliveredAt || event.eventAt < deliveredAt)
    )
      deliveredAt = event.eventAt;
    if (event.status === "READ" && (!readAt || event.eventAt < readAt))
      readAt = event.eventAt;

    if (statusRank[event.status] > statusRank[deliveryStatus]) {
      deliveryStatus = event.status;
      lastError = event.status === "FAILED" ? event.errorMessage : null;
    }
  }

  const changed =
    deliveryStatus !== notification.deliveryStatus ||
    deliveredAt?.getTime() !== notification.deliveredAt?.getTime() ||
    readAt?.getTime() !== notification.readAt?.getTime() ||
    lastError !== notification.lastError;
  if (changed) {
    await tx.notification.update({
      where: { id: notification.id },
      data: { deliveryStatus, deliveredAt, readAt, lastError },
    });
  }
  await tx.whatsAppStatusEvent.updateMany({
    where: { id: { in: events.map((event) => event.id) }, processedAt: null },
    data: { processedAt: new Date() },
  });
  return changed ? 1 : 0;
}
