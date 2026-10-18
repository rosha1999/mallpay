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
  companyName: z.string().trim().min(2).max(120).optional(),
  representativeName: z.string().trim().min(2).max(120).optional(),
  amount: moneyAmountSchema,
  phone: phoneNumberSchema,
  idempotencyKey: z.string().min(12).max(100),
});
const linkWindowMs = 60 * 60 * 1000;

function matchesExistingPublicRequest(
  existing: {
    companyId: string | null;
    companyName: string | null;
    amount: unknown;
    representativeName: string | null;
    representativePhone: string | null;
    idempotencyFingerprint: string | null;
  },
  fingerprint: string,
  companyId: string | null,
  companyName: string,
  data: z.infer<typeof schema>,
): boolean {
  if (existing.idempotencyFingerprint) {
    const legacyFingerprint = payloadFingerprint({
      type: "public-request-v1",
      companyId,
      representativeName: data.representativeName ?? null,
      representativePhone: data.phone,
      amount: data.amount,
    });
    return (
      existing.idempotencyFingerprint === fingerprint ||
      existing.idempotencyFingerprint === legacyFingerprint
    );
  }
  return (
    existing.companyId === companyId &&
    (companyId !== null || existing.companyName === companyName) &&
    toCents(existing.amount) === toCents(data.amount) &&
    existing.representativeName === (data.representativeName ?? null) &&
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
  if (!access) return null;
  if (
    access.company &&
    (!access.company.active || !access.company.mall.active)
  )
    return null;
  if (access.companyId && !access.company) return null;
  return access;
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
  if (access.company)
    return NextResponse.json({
      company: {
        name: access.company.name,
        mall: access.company.mall.name,
      },
    });

  return NextResponse.json({ company: null });
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
  if (client) {
    const ipLimit = await consumeRateLimit(
      `public-ip:${client}`,
      30,
      15 * 60 * 1000,
    );
    if (!ipLimit.allowed)
      return NextResponse.json(
        { error: "تم تجاوز عدد الطلبات المسموح. حاول مرة أخرى بعد قليل." },
        {
          status: 429,
          headers: { "Retry-After": String(ipLimit.retryAfter) },
        },
      );
  }

  let data: z.infer<typeof schema>;
  try {
    data = schema.parse(await readJsonBody(request));
  } catch (error) {
    return invalidInputResponse(
      error,
      "تحقق من اسم الشركة ورقم الهاتف والمبلغ المدخل.",
    );
  }

  const submittedCompanyName = (data.companyName ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  let targetCompany: { id: string; mallId: string; name: string } | null =
    access.company
      ? {
          id: access.company.id,
          mallId: access.company.mallId,
          name: access.company.name,
        }
      : null;
  if (!access.companyId) {
    if (!submittedCompanyName)
      return NextResponse.json(
        { error: "اكتب اسم الشركة التي تريد إرسال الطلب لها." },
        { status: 400 },
      );
    const matches = await prisma.company.findMany({
      where: {
        name: { equals: submittedCompanyName, mode: "insensitive" },
        active: true,
        mall: { is: { active: true } },
      },
      select: { id: true, mallId: true, name: true },
      take: 2,
    });
    if (matches.length === 1) targetCompany = matches[0];
  }
  const companyId = targetCompany?.id ?? null;
  const companyName = targetCompany?.name ?? submittedCompanyName;
  const mallId = targetCompany?.mallId ?? null;

  const companyRateKey =
    companyId ??
    `name-${createHash("sha256").update(companyName.toLowerCase()).digest("hex").slice(0, 24)}`;
  const linkLimit = await consumeRateLimit(
    access.companyId ? `public-link:${access.id}` : `public-link:${access.id}:${companyRateKey}`,
    20,
    linkWindowMs,
  );
  if (!linkLimit.allowed)
    return NextResponse.json(
      { error: "تم تجاوز عدد الطلبات المسموح. حاول مرة أخرى بعد قليل." },
      {
        status: 429,
        headers: { "Retry-After": String(linkLimit.retryAfter) },
      },
    );

  const fingerprint = payloadFingerprint({
    type: "public-request-v2",
    companyId,
    companyName,
    representativeName: data.representativeName ?? null,
    representativePhone: data.phone,
    amount: data.amount,
  });
  const existing = await prisma.paymentRequest.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
  });
  if (existing) {
    if (
      existing.companyId !== companyId ||
      !matchesExistingPublicRequest(
        existing,
        fingerprint,
        companyId,
        companyName,
        data,
      )
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
      if (targetCompany) {
        const activeMall = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Mall" WHERE "id" = ${targetCompany.mallId} AND "active" = true FOR SHARE
        `;
        if (!activeMall.length) throw new Error("LINK_INACTIVE");
        const activeCompany = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Company"
          WHERE "id" = ${targetCompany.id}
            AND "mallId" = ${targetCompany.mallId}
            AND "active" = true
          FOR SHARE
        `;
        if (!activeCompany.length) throw new Error("LINK_INACTIVE");
      }
      const activeToken = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "CompanyToken"
        WHERE "id" = ${access.id}
          AND "revokedAt" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt" > ${new Date()})
          AND ("companyId" IS NULL OR "companyId" = ${access.companyId})
        FOR SHARE
      `;
      if (!activeToken.length) throw new Error("LINK_INACTIVE");

      const paymentRequest = await tx.paymentRequest.create({
        data: {
          companyId,
          mallId,
          companyName,
          amount: data.amount,
          dueAt: null,
          status: "PENDING",
          representativeName: data.representativeName ?? null,
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
        const message = `طلب جديد من ${companyName}`;
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
              message: `وصل طلب تسديد جديد من ${companyName}. رقم الطلب ${paymentRequest.reference}، المبلغ ${data.amount} د.ع.`,
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
        duplicate?.companyId === companyId &&
        matchesExistingPublicRequest(
          duplicate,
          fingerprint,
          companyId,
          companyName,
          data,
        )
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
