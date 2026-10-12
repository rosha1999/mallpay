import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  invalidInputResponse,
  readJsonBody,
  requireAdmin,
  requireAdminMutation,
} from "@/lib/http";
import { moneyAmountSchema, toCents } from "@/lib/money";
import { payloadFingerprint } from "@/lib/idempotency";
import { normalizePhoneNumber } from "@/lib/phone";
import { formatBaghdadDateTime } from "@/lib/dates";
import { futureAppointmentAtSchema } from "@/lib/appointments";

const schema = z.object({
  companyId: z.string().min(1),
  mallId: z.string().min(1),
  amount: moneyAmountSchema,
  dueAt: z.string().datetime().optional(),
  appointmentAt: futureAppointmentAtSchema.optional(),
  note: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(12).max(100),
});
const statusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "RESCHEDULED",
  "REJECTED",
  "PAID",
  "CANCELLED",
]);
const pageSize = 50;

function matchesExistingRequest(
  existing: {
    companyId: string;
    mallId: string;
    amount: unknown;
    dueAt: Date | null;
    appointmentAt: Date | null;
    note: string | null;
    idempotencyFingerprint: string | null;
  },
  fingerprint: string,
  expected: {
    companyId: string;
    mallId: string;
    amount: string;
    dueAt: Date | null;
    appointmentAt: Date | null;
    note: string | null;
  },
): boolean {
  if (existing.idempotencyFingerprint)
    return existing.idempotencyFingerprint === fingerprint;
  return (
    existing.companyId === expected.companyId &&
    existing.mallId === expected.mallId &&
    toCents(existing.amount) === toCents(expected.amount) &&
    existing.dueAt?.getTime() === expected.dueAt?.getTime() &&
    existing.appointmentAt?.getTime() === expected.appointmentAt?.getTime() &&
    existing.note === expected.note
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const statusParam = request.nextUrl.searchParams.get("status");
  const parsedStatus = statusSchema.safeParse(statusParam);
  if (statusParam && !parsedStatus.success) {
    return NextResponse.json(
      { error: "حالة الطلب غير صحيحة" },
      { status: 400 },
    );
  }

  const mallId = request.nextUrl.searchParams.get("mallId");
  const companyId = request.nextUrl.searchParams.get("companyId");
  const rawPage = request.nextUrl.searchParams.get("page");
  const requestedPage = rawPage === null ? 1 : Number(rawPage);
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1)
    return NextResponse.json({ error: "رقم الصفحة غير صالح" }, { status: 400 });

  const where = {
    ...(parsedStatus.success && statusParam
      ? { status: parsedStatus.data }
      : {}),
    ...(mallId ? { mallId } : {}),
    ...(companyId ? { companyId } : {}),
  };
  const total = await prisma.paymentRequest.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const rows = await prisma.paymentRequest.findMany({
    where,
    include: { company: true, mall: true, payments: true },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return NextResponse.json({ rows, total, page, pageCount });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminMutation(request);
  if (auth.response) return auth.response;

  let data: z.infer<typeof schema>;
  try {
    data = schema.parse(await readJsonBody(request));
  } catch (error) {
    return invalidInputResponse(error, "بيانات الطلب غير صالحة");
  }

  const company = await prisma.company.findUnique({
    where: { id: data.companyId },
    select: {
      mallId: true,
      phone: true,
      email: true,
      active: true,
      mall: { select: { active: true } },
    },
  });
  if (!company)
    return NextResponse.json({ error: "الشركة غير موجودة" }, { status: 404 });
  if (company.mallId !== data.mallId) {
    return NextResponse.json(
      { error: "المول المحدد لا يتبع هذه الشركة" },
      { status: 400 },
    );
  }

  const scheduledAt = data.appointmentAt ? new Date(data.appointmentAt) : null;
  const dueAt = scheduledAt ?? (data.dueAt ? new Date(data.dueAt) : null);
  const expected = {
    companyId: data.companyId,
    mallId: data.mallId,
    amount: data.amount,
    dueAt,
    appointmentAt: scheduledAt,
    note: data.note ?? null,
  };
  const fingerprint = payloadFingerprint({
    type: "admin-request-v1",
    ...expected,
  });
  const existing = await prisma.paymentRequest.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
  });
  if (existing) {
    if (!matchesExistingRequest(existing, fingerprint, expected)) {
      return NextResponse.json(
        { error: "مفتاح الطلب مستخدم لطلب آخر" },
        { status: 409 },
      );
    }
    return NextResponse.json(existing);
  }
  if (!company.active || !company.mall.active) {
    return NextResponse.json(
      { error: "لا يمكن إنشاء طلب لشركة أو مول متوقف." },
      { status: 409 },
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const activeMall = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Mall" WHERE "id" = ${data.mallId} AND "active" = true FOR SHARE
      `;
      if (!activeMall.length) throw new Error("INACTIVE_PARENT");
      const activeCompany = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Company"
        WHERE "id" = ${data.companyId} AND "mallId" = ${data.mallId} AND "active" = true
        FOR SHARE
      `;
      if (!activeCompany.length) throw new Error("INACTIVE_PARENT");
      const paymentRequest = await tx.paymentRequest.create({
        data: {
          companyId: data.companyId,
          mallId: data.mallId,
          amount: data.amount,
          dueAt: scheduledAt ?? (data.dueAt ? new Date(data.dueAt) : null),
          appointmentAt: scheduledAt,
          status: scheduledAt ? "APPROVED" : "PENDING",
          note: data.note,
          idempotencyKey: data.idempotencyKey,
          idempotencyFingerprint: fingerprint,
        },
      });
      if (scheduledAt) {
        const appointment = await tx.appointment.create({
          data: {
            companyId: data.companyId,
            requestId: paymentRequest.id,
            scheduledAt,
            status: "SCHEDULED",
            note: data.note,
          },
        });
        const recipient = company.phone
          ? normalizePhoneNumber(company.phone)
          : null;
        if (recipient) {
          await tx.notification.create({
            data: {
              requestId: paymentRequest.id,
              adminId: auth.admin!.id,
              channel: "WHATSAPP",
              deliveryStatus: "QUEUED",
              recipient,
              message: `تم تحديد موعد طلب ${paymentRequest.reference} بتاريخ ${formatBaghdadDateTime(scheduledAt)}`,
              dedupeKey: `request:${paymentRequest.id}:appointment:${appointment.id}`,
            },
          });
        }
        if (company.email) {
          await tx.notification.create({
            data: {
              requestId: paymentRequest.id,
              channel: "EMAIL",
              deliveryStatus: "QUEUED",
              recipient: company.email,
              message: `تم تحديد موعد طلب ${paymentRequest.reference} بتاريخ ${formatBaghdadDateTime(scheduledAt)}.`,
              dedupeKey: `request:${paymentRequest.id}:email:appointment:${appointment.id}`,
            },
          });
        }
      }
      await tx.notification.create({
        data: {
          requestId: paymentRequest.id,
          adminId: auth.admin!.id,
          channel: "IN_APP",
          deliveryStatus: "QUEUED",
          message: `طلب تسديد جديد رقم ${paymentRequest.reference}`,
          dedupeKey: `request:${paymentRequest.id}:created`,
        },
      });
      await tx.auditLog.create({
        data: {
          adminId: auth.admin!.id,
          action: "CREATE",
          entityType: "PaymentRequest",
          entityId: paymentRequest.id,
        },
      });
      return paymentRequest;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "INACTIVE_PARENT")
      return NextResponse.json(
        { error: "لا يمكن إنشاء طلب لشركة أو مول متوقف." },
        { status: 409 },
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const duplicate = await prisma.paymentRequest.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (
        duplicate &&
        matchesExistingRequest(duplicate, fingerprint, expected)
      ) {
        return NextResponse.json(duplicate);
      }
      return NextResponse.json(
        { error: "مفتاح الطلب مستخدم لطلب آخر" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "تعذر حفظ الطلب حالياً" },
      { status: 500 },
    );
  }
}
