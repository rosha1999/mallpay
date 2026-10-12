import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  invalidInputResponse,
  readJsonBody,
  sameOriginError,
} from "@/lib/http";
import { payloadFingerprint } from "@/lib/idempotency";
import { clientIdentifier, consumeRateLimit } from "@/lib/rate-limit";
import { moneyAmountSchema, toCents } from "@/lib/money";
import { phoneNumberSchema } from "@/lib/phone";

const schema = z.object({
  representativeName: z.string().trim().min(2).max(120),
  amount: moneyAmountSchema,
  phone: phoneNumberSchema,
  idempotencyKey: z.string().min(12).max(100),
});
const linkWindowMs = 60 * 60 * 1000;

function matchesExistingPublicRequest(
  existing: {
    companyId: string;
    amount: unknown;
    representativeName: string | null;
    representativePhone: string | null;
    idempotencyFingerprint: string | null;
  },
  fingerprint: string,
  data: z.infer<typeof schema>,
): boolean {
  if (existing.idempotencyFingerprint)
    return existing.idempotencyFingerprint === fingerprint;
  return (
    toCents(existing.amount) === toCents(data.amount) &&
    existing.representativeName === data.representativeName &&
    existing.representativePhone === data.phone
  );
}

async function findAccess(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const access = await prisma.companyToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { company: { include: { mall: true } } },
  });
  return access?.company.active && access.company.mall.active ? access : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const access = await findAccess(token);
  if (!access)
    return NextResponse.json(
      { error: "الرابط غير صالح أو منتهي" },
      { status: 404 },
    );
  return NextResponse.json({
    company: { name: access.company.name, mall: access.company.mall.name },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  const { token } = await params;
  const access = await findAccess(token);
  if (!access)
    return NextResponse.json(
      { error: "الرابط غير صالح أو منتهي" },
      { status: 404 },
    );

  const client = clientIdentifier(request);
  const limits = await Promise.all([
    ...(client
      ? [consumeRateLimit(`public-ip:${client}`, 30, 15 * 60 * 1000)]
      : []),
    consumeRateLimit(`public-link:${access.id}`, 20, linkWindowMs),
  ]);
  const blocked = limits.find((result) => !result.allowed);
  if (blocked) {
    return NextResponse.json(
      { error: "تم تجاوز عدد الطلبات المسموح. حاول مرة أخرى بعد قليل." },
      { status: 429, headers: { "Retry-After": String(blocked.retryAfter) } },
    );
  }

  let data: z.infer<typeof schema>;
  try {
    data = schema.parse(await readJsonBody(request));
  } catch (error) {
    return invalidInputResponse(
      error,
      "تحقق من الاسم ورقم الهاتف والمبلغ المدخل.",
    );
  }

  const fingerprint = payloadFingerprint({
    type: "public-request-v1",
    companyId: access.companyId,
    representativeName: data.representativeName,
    representativePhone: data.phone,
    amount: data.amount,
  });
  const existing = await prisma.paymentRequest.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
  });
  if (existing) {
    if (
      existing.companyId !== access.companyId ||
      !matchesExistingPublicRequest(existing, fingerprint, data)
    ) {
      return NextResponse.json(
        { error: "مفتاح الطلب غير صالح" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, reference: existing.reference });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const activeMall = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Mall" WHERE "id" = ${access.company.mallId} AND "active" = true FOR SHARE
      `;
      if (!activeMall.length) throw new Error("LINK_INACTIVE");
      const activeCompany = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Company"
        WHERE "id" = ${access.companyId} AND "active" = true
        FOR SHARE
      `;
      if (!activeCompany.length) throw new Error("LINK_INACTIVE");
      const activeToken = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "CompanyToken"
        WHERE "id" = ${access.id}
          AND "revokedAt" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt" > ${new Date()})
        FOR SHARE
      `;
      if (!activeToken.length) throw new Error("LINK_INACTIVE");

      const paymentRequest = await tx.paymentRequest.create({
        data: {
          companyId: access.companyId,
          mallId: access.company.mallId,
          amount: data.amount,
          dueAt: null,
          status: "PENDING",
          representativeName: data.representativeName,
          representativePhone: data.phone,
          idempotencyKey: data.idempotencyKey,
          idempotencyFingerprint: fingerprint,
          createdByCompanyTokenId: access.id,
        },
      });
      const admins = await tx.adminUser.findMany({
        where: { active: true },
        select: { id: true, email: true },
      });
      if (admins.length) {
        const message = `طلب جديد من ${access.company.name} — ${data.representativeName}`;
        const createdAt = new Date();
        await tx.notification.createMany({
          data: admins.flatMap((admin) => [
            {
              requestId: paymentRequest.id,
              adminId: admin.id,
              channel: "IN_APP" as const,
              deliveryStatus: "SENT" as const,
              sentAt: createdAt,
              message,
              dedupeKey: `request:${paymentRequest.id}:in-app:${admin.id}:received`,
            },
            {
              requestId: paymentRequest.id,
              adminId: admin.id,
              channel: "EMAIL" as const,
              deliveryStatus: "QUEUED" as const,
              recipient: admin.email,
              message: `وصل طلب تسديد جديد من ${access.company.name}. رقم الطلب ${paymentRequest.reference}، المبلغ ${data.amount} د.ع.`,
              dedupeKey: `request:${paymentRequest.id}:email:${admin.id}:received`,
            },
          ]),
        });
      }
      return paymentRequest;
    });
    return NextResponse.json(
      { ok: true, reference: created.reference },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "LINK_INACTIVE")
      return NextResponse.json(
        { error: "الرابط غير صالح أو منتهي" },
        { status: 404 },
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const duplicate = await prisma.paymentRequest.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (
        duplicate?.companyId === access.companyId &&
        matchesExistingPublicRequest(duplicate, fingerprint, data)
      ) {
        return NextResponse.json({ ok: true, reference: duplicate.reference });
      }
      return NextResponse.json(
        { error: "مفتاح الطلب غير صالح" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "تعذر إرسال الطلب حالياً. حاول مرة أخرى." },
      { status: 500 },
    );
  }
}
