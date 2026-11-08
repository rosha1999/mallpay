import { prisma } from "@/lib/prisma";
import { normalizePhoneNumber } from "@/lib/phone";
import { whatsappApiConfig, whatsappMessagePayload } from "@/lib/whatsapp";
import { applyPendingWhatsAppStatusEvents } from "@/lib/whatsapp-events";
import { emailApiConfig, sendNotificationEmail } from "@/lib/email";
import {
  isRetryableOpenWaError,
  openWaConfig,
  resolveOpenWaSessionId,
  sendOpenWaTextMessage,
} from "@/lib/openwa";

export type NotificationDispatchSummary = {
  providersConfigured: boolean;
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  recovered: number;
};

// Sends queued WHATSAPP/EMAIL notifications. WhatsApp goes through OpenWA
// when it is configured (OPENWA_*), otherwise through the Meta Cloud API.
// If the OpenWA gateway cannot be reached, its notifications stay QUEUED
// for the next run instead of being marked FAILED. The same applies when
// the gateway answers but its WhatsApp session is not active yet.
export async function runNotificationDispatch(): Promise<NotificationDispatchSummary> {
  const whatsapp = whatsappApiConfig();
  const email = emailApiConfig();
  const openwa = openWaConfig();
  let openwaSessionId: string | null = null;
  if (openwa) {
    try {
      openwaSessionId = await resolveOpenWaSessionId(openwa);
    } catch {
      openwaSessionId = null;
    }
  }
  const useOpenWa = Boolean(openwa && openwaSessionId);
  if (!useOpenWa && !whatsapp && !email)
    return {
      providersConfigured: false,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      recovered: 0,
    };

  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  const recovered = await prisma.notification.updateMany({
    where: { deliveryStatus: "PROCESSING", updatedAt: { lt: staleBefore } },
    data: {
      deliveryStatus: "FAILED",
      lastError:
        "Worker lease expired; verify the provider before manually retrying.",
    },
  });

  // Fetch only channels that have a configured provider. Otherwise the
  // oldest-first batch fills up with notifications that can only be
  // skipped (e.g. email while email is unconfigured) and newer WhatsApp
  // notifications behind them never get a turn.
  const channels: Array<"WHATSAPP" | "EMAIL"> = [];
  if (useOpenWa || whatsapp) channels.push("WHATSAPP");
  if (email) channels.push("EMAIL");
  const queued = await prisma.notification.findMany({
    where: {
      deliveryStatus: "QUEUED",
      channel: { in: channels },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  let sent = 0,
    failed = 0,
    skipped = 0;
  let openWaUnavailable = false;
  for (const n of queued) {
    if (n.channel === "IN_APP") {
      skipped++;
      continue;
    }
    if (
      (n.channel === "WHATSAPP" && !useOpenWa && !whatsapp) ||
      (n.channel === "EMAIL" && !email)
    ) {
      skipped++;
      continue;
    }
    // Once the gateway/session has failed as "not ready" in this run, the
    // remaining WhatsApp items would fail the same way; leave them queued
    // and untouched for the next run instead of burning an attempt on each.
    if (n.channel === "WHATSAPP" && useOpenWa && openWaUnavailable) {
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
      } else if (useOpenWa) {
        providerMessageId = await sendOpenWaTextMessage(
          openwa!,
          openwaSessionId!,
          recipient,
          n.message,
        );
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
      if (n.channel === "WHATSAPP" && !useOpenWa) {
        await prisma.$transaction((tx) =>
          applyPendingWhatsAppStatusEvents(tx, providerMessageId!),
        );
      }
    } catch (e) {
      if (messageRecorded) {
        skipped++;
        continue;
      }
      if (n.channel === "WHATSAPP" && useOpenWa && isRetryableOpenWaError(e)) {
        // The gateway or its WhatsApp session is not ready (for example the
        // session did not come back after the host PC restarted). Return the
        // notification to the queue so a later run delivers it once the
        // gateway is back, instead of losing the message as FAILED.
        await prisma.notification.updateMany({
          where: { id: n.id, deliveryStatus: "PROCESSING" },
          data: {
            deliveryStatus: "QUEUED",
            lastError:
              e instanceof Error ? e.message.slice(0, 500) : "OpenWA unavailable",
          },
        });
        openWaUnavailable = true;
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
  return {
    providersConfigured: true,
    processed: queued.length,
    sent,
    failed,
    skipped,
    recovered: recovered.count,
  };
}
