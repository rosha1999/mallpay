import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isRequestBodyError, readRawBodyLimited } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { isConfiguredSecret } from "@/lib/secrets";
import {
  applyPendingWhatsAppStatusEvents,
  parseWhatsAppEventTime,
  verifyWhatsAppWebhookSignature,
  whatsappStatusEventKey,
  type WhatsAppEventStatus,
} from "@/lib/whatsapp-events";

const statusSchema = z
  .object({
    id: z.string().min(1).max(250),
    status: z.enum(["sent", "delivered", "read", "failed"]),
    timestamp: z.string().max(20).optional(),
    errors: z
      .array(
        z
          .object({
            code: z.number().int().optional(),
            title: z.string().max(500).optional(),
            message: z.string().max(500).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
const payloadSchema = z
  .object({
    entry: z.array(
      z
        .object({
          changes: z.array(
            z
              .object({
                value: z
                  .object({ statuses: z.array(statusSchema).optional() })
                  .passthrough(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();
function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export async function GET(request: NextRequest) {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (
    isConfiguredSecret(verifyToken) &&
    mode === "subscribe" &&
    token &&
    challenge &&
    safeEqual(token, verifyToken)
  ) {
    return new NextResponse(challenge, {
      headers: { "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const signature = request.headers.get("x-hub-signature-256");
  if (!isConfiguredSecret(appSecret) || !signature)
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    return NextResponse.json(
      { error: "يجب إرسال الإشعار بصيغة JSON" },
      { status: 415 },
    );
  }
  let rawBody: Uint8Array;
  try {
    rawBody = await readRawBodyLimited(request, 1_000_000);
  } catch (error) {
    if (isRequestBodyError(error))
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    return NextResponse.json({ error: "تعذر قراءة الإشعار" }, { status: 400 });
  }
  if (!verifyWhatsAppWebhookSignature(rawBody, signature, appSecret))
    return NextResponse.json({ error: "توقيع غير صالح" }, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(rawBody),
    );
  } catch {
    return NextResponse.json(
      { error: "بيانات الإشعار غير صالحة" },
      { status: 400 },
    );
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json(
      { error: "صيغة إشعار غير مدعومة" },
      { status: 400 },
    );

  const updates = parsed.data.entry.flatMap((entry) =>
    entry.changes.flatMap((change) => change.value.statuses ?? []),
  );
  if (updates.length > 100)
    return NextResponse.json(
      { error: "عدد تحديثات الحالة أكبر من المسموح" },
      { status: 413 },
    );
  const eventRows = updates.map((event) => {
    const status = event.status.toUpperCase() as WhatsAppEventStatus;
    const eventAt = parseWhatsAppEventTime(event.timestamp);
    const error = event.errors?.[0];
    const errorMessage =
      status === "FAILED"
        ? [
            error?.title,
            error?.message,
            error?.code ? `code ${error.code}` : null,
          ]
            .filter(Boolean)
            .join(": ")
            .slice(0, 500) || "WhatsApp delivery failed"
        : null;
    return {
      id: randomUUID(),
      providerMessageId: event.id,
      status,
      eventAt,
      errorMessage,
      dedupeKey: whatsappStatusEventKey(
        event.id,
        status,
        eventAt,
        errorMessage,
      ),
    };
  });

  if (eventRows.length) {
    await prisma.whatsAppStatusEvent.createMany({
      data: eventRows,
      skipDuplicates: true,
    });
  }
  let updated = 0;
  for (const providerMessageId of new Set(
    eventRows.map((event) => event.providerMessageId),
  )) {
    updated += await prisma.$transaction((tx) =>
      applyPendingWhatsAppStatusEvents(tx, providerMessageId),
    );
  }

  void prisma.whatsAppStatusEvent
    .deleteMany({
      where: {
        processedAt: { not: null },
        createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    })
    .catch(() => undefined);

  return NextResponse.json({ received: updates.length, updated });
}
