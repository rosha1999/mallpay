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
import { formatBaghdadDate } from "@/lib/dates";

const schema = z.object({
  companyName: z.string().trim().min(2).max(120).optional(),
  mallId: z.string().trim().min(1).max(100).optional(),
  representativeName: z.string().trim().min(2).max(120).optional(),
  note: z.string().trim().max(1000).optional(),
  amount: moneyAmountSchema,
  phone: phoneNumberSchema,
  idempotencyKey: z.string().min(12).max(100),
});
const linkWindowMs = 60 * 60 * 1000;
const requestCooldownMs = 20 * 24 * 60 * 60 * 1000;

function companyRequestWhere(
  mallId: string,
  companyId: string | null,
  companyName: string,
): Prisma.PaymentRequestWhereInput {
  return {
    mallId,
    ...(companyId
      ? { companyId }
      : {
          companyId: null,
          companyName: { equals: companyName, mode: "insensitive" },
        }),
  };
}

function cooldownMessage(createdAt: Date): string {
  const remainingMs = requestCooldownMs - (Date.now() - createdAt.getTime());
  const days = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  const availableAt = new Date(createdAt.getTime() + requestCooldownMs);
  return `لا يمكن إرسال طلب جديد لنفس الشركة قبل مرور 20 يوماً من الطلب الأخير. باقي ${days} يوم، ويمكن الإرسال من ${formatBaghdadDate(availableAt)}.`;
}

function matchesExistingPublicRequest(
  existing: {
    companyId: string | null;
    mallId: string | null;
    companyName: string | null;
    createdByCompanyTokenId: string | null;
    amount: unknown;
    representativeName: string | null;
    representativePhone: string | null;
    representativeNote: string | null;
    idempotencyFingerprint: string | null;
  },
  fingerprint: string,
  companyId: string | null,
  mallId: string | null,
  companyName: string,
  data: z.infer<typeof schema>,
  note: string | null,
): boolean {
  const existingName = (existing.companyName ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  const requestedName = companyName.replace(/\s+/gu, " ").trim().toLowerCase();
  if (
    existingName !== requestedName &&
    !(existing.companyId !== null && existing.companyId === companyId)
  )
    return false;

  if (existing.idempotencyFingerprint) {
    const legacyCompanyFingerprint = payloadFingerprint({
      type: "public-request-v1",
      companyId: existing.companyId,
      representativeName: data.representativeName ?? null,
      representativePhone: data.phone,
      amount: data.amount,
    });
    const typedCompanyFingerprint = payloadFingerprint({
      type: "public-request-v2",
      companyId: existing.companyId,
      companyName: existing.companyName ?? companyName,
      representativeName: data.representativeName ?? null,
      representativePhone: data.phone,
      amount: data.amount,
    });
    const previousFingerprint = payloadFingerprint({
      type: "public-request-v3",
      companyId: existing.companyId,
      mallId: existing.mallId,
      companyName: existing.companyName ?? companyName,
      representativeName: data.representativeName ?? null,
      representativePhone: data.phone,
      amount: data.amount,
    });
    return (
      existing.idempotencyFingerprint === fingerprint ||
      existing.idempotencyFingerprint === legacyCompanyFingerprint ||
      existing.idempotencyFingerprint === typedCompanyFingerprint ||
      existing.idempotencyFingerprint === previousFingerprint
    );
  }
  return (
    existing.companyId === companyId &&
    (existing.mallId === mallId ||
      (existing.companyId === null && existing.mallId === null)) &&
    toCents(existing.amount) === toCents(data.amount) &&
    existing.representativeName === (data.representativeName ?? null) &&
    existing.representativePhone === data.phone &&
    (existing.representativeNote ?? null) === note
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

  const malls = await prisma.mall.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ company: null, malls });
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
      "تحقق من اسم الشركة والمول ورقم الهاتف والمبلغ المدخل.",
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
  let mallId = targetCompany?.mallId ?? null;
  if (!access.companyId) {
    if (!submittedCompanyName)
      return NextResponse.json(
        { error: "اكتب اسم الشركة التي تريد إرسال الطلب لها." },
        { status: 400 },
      );
    if (!data.mallId)
      return NextResponse.json(
        { error: "اختار المول الذي تتبع له الشركة." },
        { status: 400 },
      );
    const selectedMall = await prisma.mall.findFirst({
      where: { id: data.mallId, active: true },
      select: { id: true },
    });
    if (!selectedMall)
      return NextResponse.json(
        { error: "المول المحدد غير موجود أو متوقف." },
        { status: 400 },
      );
    mallId = selectedMall.id;
    const matches = await prisma.company.findMany({
      where: {
        name: { equals: submittedCompanyName, mode: "insensitive" },
        mallId,
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
  mallId = targetCompany?.mallId ?? mallId;
  if (!mallId)
    return NextResponse.json(
      { error: "اختار المول الذي تتبع له الشركة." },
      { status: 400 },
    );
  const requestMallId = mallId;

  const companyRateKey =
    companyId ??
    `name-${createHash("sha256").update(`${mallId}:${companyName.toLowerCase()}`).digest("hex").slice(0, 24)}`;
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

  const note = data.note?.trim() || null;
  const fingerprint = payloadFingerprint({
    type: "public-request-v4",
    companyId,
    mallId,
    companyName,
    representativeName: data.representativeName ?? null,
    representativePhone: data.phone,
    note,
    amount: data.amount,
  });
  const existing = await prisma.paymentRequest.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
  });
  if (existing) {
    if (
      existing.createdByCompanyTokenId !== access.id ||
      !matchesExistingPublicRequest(
        existing,
        fingerprint,
        companyId,
        mallId,
        companyName,
        data,
        note,
      )
    ) {
      return NextResponse.json(
        { error: "مفتاح الطلب غير صالح" },
        { status: 409 },
      );
    }
    if (existing.companyId === null && existing.mallId === null && mallId) {
      await prisma.paymentRequest.updateMany({
        where: { id: existing.id, companyId: null, mallId: null },
        data: { mallId },
      });
    }
    return NextResponse.json({ ok: true, reference: existing.reference });
  }

  const previousRequest = await prisma.paymentRequest.findFirst({
    where: companyRequestWhere(requestMallId, companyId, companyName),
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (
    previousRequest &&
    Date.now() - previousRequest.createdAt.getTime() < requestCooldownMs
  )
    return NextResponse.json(
      { error: cooldownMessage(previousRequest.createdAt) },
      { status: 400 },
    );

  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`public-request-cooldown:${requestMallId}:${companyName.toLowerCase()}`}))`;
      const lastRequest = await tx.paymentRequest.findFirst({
        where: companyRequestWhere(requestMallId, companyId, companyName),
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (
        lastRequest &&
        Date.now() - lastRequest.createdAt.getTime() < requestCooldownMs
      )
        throw new Error(`COOLDOWN:${cooldownMessage(lastRequest.createdAt)}`);

      const activeMall = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Mall" WHERE "id" = ${mallId} AND "active" = true FOR SHARE
      `;
      if (!activeMall.length) throw new Error("LINK_INACTIVE");
      if (targetCompany) {
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
          representativeNote: note,
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
    if (error instanceof Error && error.message.startsWith("COOLDOWN:"))
      return NextResponse.json(
        { error: error.message.slice("COOLDOWN:".length) },
        { status: 400 },
      );
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
        duplicate?.createdByCompanyTokenId === access.id &&
        matchesExistingPublicRequest(
          duplicate,
          fingerprint,
          companyId,
          mallId,
          companyName,
          data,
          note,
        )
      ) {
        if (duplicate.companyId === null && duplicate.mallId === null && mallId) {
          await prisma.paymentRequest.updateMany({
            where: { id: duplicate.id, companyId: null, mallId: null },
            data: { mallId },
          });
        }
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
