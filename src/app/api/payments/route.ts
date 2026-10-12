import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  invalidInputResponse,
  readJsonBody,
  requireAdminMutation,
} from "@/lib/http";
import { moneyAmountSchema, toCents } from "@/lib/money";

const schema = z.object({
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(12).max(100),
  amount: moneyAmountSchema,
  paidAt: z.string().datetime().optional(),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]),
  notes: z.string().max(1000).optional(),
});

function matchesExistingPayment(
  payment: {
    requestId: string;
    amount: unknown;
    method: string;
    notes: string | null;
    paidAt: Date;
  },
  data: z.infer<typeof schema>,
): boolean {
  return (
    payment.requestId === data.requestId &&
    toCents(payment.amount) === toCents(data.amount) &&
    payment.method === data.method &&
    (payment.notes ?? "") === (data.notes ?? "") &&
    (!data.paidAt ||
      payment.paidAt.getTime() === new Date(data.paidAt).getTime())
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminMutation(request);
  if (auth.response) return auth.response;

  let data: z.infer<typeof schema>;
  try {
    data = schema.parse(await readJsonBody(request));
  } catch (error) {
    return invalidInputResponse(error, "بيانات الدفعة غير صالحة");
  }

  const existing = await prisma.payment.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
  });
  if (existing) {
    if (!matchesExistingPayment(existing, data)) {
      return NextResponse.json(
        {
          error: "مفتاح الدفعة مستخدم لبيانات مختلفة",
          code: "IDEMPOTENCY_KEY_MISMATCH",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(existing);
  }

  try {
    const payment = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "PaymentRequest" WHERE "id" = ${data.requestId} FOR UPDATE`;
        const paymentRequest = await tx.paymentRequest.findUnique({
          where: { id: data.requestId },
          include: { payments: true, company: true },
        });
        if (!paymentRequest) throw new Error("NOT_FOUND");
        if (["REJECTED", "CANCELLED", "PAID"].includes(paymentRequest.status))
          throw new Error("INVALID_STATUS");

        const requestedCents = toCents(paymentRequest.amount);
        const paymentCents = toCents(data.amount);
        if (requestedCents === null || paymentCents === null)
          throw new Error("INVALID_AMOUNT");
        const paidCents = paymentRequest.payments.reduce((sum, item) => {
          const amount = toCents(item.amount);
          if (amount === null) throw new Error("INVALID_AMOUNT");
          return sum + amount;
        }, 0n);
        const totalCents = paidCents + paymentCents;
        if (totalCents > requestedCents) throw new Error("OVERPAYMENT");

        const created = await tx.payment.create({
          data: {
            requestId: paymentRequest.id,
            companyId: paymentRequest.companyId,
            amount: data.amount,
            idempotencyKey: data.idempotencyKey,
            paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
            method: data.method,
            notes: data.notes,
            adminId: auth.admin!.id,
          },
        });
        await tx.paymentRequest.update({
          where: { id: paymentRequest.id },
          data: {
            status:
              totalCents === requestedCents ? "PAID" : paymentRequest.status,
          },
        });
        if (totalCents === requestedCents) {
          await tx.appointment.updateMany({
            where: { requestId: paymentRequest.id, status: "SCHEDULED" },
            data: { status: "CANCELLED" },
          });
        }
        await tx.auditLog.create({
          data: {
            adminId: auth.admin!.id,
            action: "PAYMENT_RECORDED",
            entityType: "Payment",
            entityId: created.id,
            metadata: { requestId: paymentRequest.id, amount: data.amount },
          },
        });
        if (paymentRequest.company.email) {
          await tx.notification.create({
            data: {
              requestId: paymentRequest.id,
              channel: "EMAIL",
              deliveryStatus: "QUEUED",
              recipient: paymentRequest.company.email,
              message: `تم تسجيل دفعة ${data.amount} د.ع لطلب ${paymentRequest.reference} في ${paymentRequest.company.name}.`,
              dedupeKey: `payment:${created.id}:receipt`,
            },
          });
        }
        return created;
      },
      { isolationLevel: "Serializable" },
    );

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const duplicate = await prisma.payment.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (duplicate && matchesExistingPayment(duplicate, data))
        return NextResponse.json(duplicate);
      return NextResponse.json(
        {
          error: "مفتاح الدفعة مستخدم لبيانات مختلفة",
          code: "IDEMPOTENCY_KEY_MISMATCH",
        },
        { status: 409 },
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      const duplicate = await prisma.payment
        .findUnique({ where: { idempotencyKey: data.idempotencyKey } })
        .catch(() => null);
      if (duplicate && matchesExistingPayment(duplicate, data))
        return NextResponse.json(duplicate);
      return NextResponse.json(
        {
          error: "حدث تعارض بسبب عملية مالية متزامنة. أعد المحاولة بنفس الطلب.",
          code: "RETRY_SAME_KEY",
        },
        { status: 409 },
      );
    }
    const code = error instanceof Error ? error.message : "";
    const status =
      code === "NOT_FOUND"
        ? 404
        : ["INVALID_STATUS", "OVERPAYMENT"].includes(code)
          ? 409
          : code === "INVALID_AMOUNT"
            ? 400
            : 500;
    const message =
      code === "NOT_FOUND"
        ? "الطلب غير موجود"
        : code === "INVALID_STATUS"
          ? "لا يمكن تسجيل دفعة لطلب مرفوض أو ملغى أو مدفوع بالكامل"
          : code === "INVALID_AMOUNT"
            ? "مبلغ الدفعة أو رصيد الطلب غير صالح"
            : code === "OVERPAYMENT"
              ? "المبلغ يتجاوز الرصيد المتبقي"
              : "تعذر تسجيل الدفعة حالياً";
    return NextResponse.json({ error: message }, { status });
  }
}
