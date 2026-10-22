import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/http";
import { fromCents, toCents } from "@/lib/money";
import { dateTimeToIsoInBaghdad } from "@/lib/dates";

const statusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "RESCHEDULED",
  "REJECTED",
  "PAID",
  "CANCELLED",
]);

// Rows are streamed in batches so a large export never loads everything
// into memory at once; requests beyond this are rejected with 413.
const EXPORT_BATCH_SIZE = 500;
const MAX_EXPORT_ROWS = 50_000;

function csv(value: unknown): string {
  let text = String(value ?? "");
  if (/^\s*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function nextCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const params = request.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const statusParam = params.get("status");
  const status = statusSchema.safeParse(statusParam);
  if (statusParam && !status.success)
    return NextResponse.json(
      { error: "حالة الطلب غير صحيحة" },
      { status: 400 },
    );

  const fromIso = from ? dateTimeToIsoInBaghdad(from, "00:00") : null;
  const toIso = to ? dateTimeToIsoInBaghdad(to, "00:00") : null;
  if ((from && !fromIso) || (to && !toIso)) {
    return NextResponse.json(
      { error: "نطاق التاريخ غير صالح" },
      { status: 400 },
    );
  }
  if (from && to && from > to) {
    return NextResponse.json(
      { error: "يجب أن يكون تاريخ البداية قبل تاريخ النهاية" },
      { status: 400 },
    );
  }
  const fromDate = fromIso ? new Date(fromIso) : null;
  const toDateExclusive = toIso
    ? new Date(dateTimeToIsoInBaghdad(nextCalendarDate(to!), "00:00")!)
    : null;

  const where = {
    ...(fromDate || toDateExclusive
      ? {
          requestedAt: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDateExclusive ? { lt: toDateExclusive } : {}),
          },
        }
      : {}),
    ...(params.get("mallId") ? { mallId: params.get("mallId")! } : {}),
    ...(params.get("companyId") ? { companyId: params.get("companyId")! } : {}),
    ...(status.success && statusParam ? { status: status.data } : {}),
  };
  const orderBy: Prisma.PaymentRequestOrderByWithRelationInput[] = [
    { requestedAt: "desc" },
    { id: "desc" },
  ];

  // Guard: refuse absurd ranges up front instead of streaming forever.
  const totalRows = await prisma.paymentRequest.count({ where });
  if (totalRows > MAX_EXPORT_ROWS) {
    return NextResponse.json(
      {
        error: `عدد الصفوف (${totalRows.toLocaleString("en")}) يتجاوز الحد المسموح (${MAX_EXPORT_ROWS.toLocaleString("en")}). ضيّق نطاق التاريخ أو الفلاتر.`,
      },
      { status: 413 },
    );
  }

  await prisma.auditLog.create({
    data: {
      adminId: auth.admin!.id,
      action: "EXPORT_CSV",
      entityType: "PaymentRequest",
      metadata: {
        rowCount: totalRows,
        filters: {
          from: from ?? null,
          to: to ?? null,
          mallId: params.get("mallId"),
          companyId: params.get("companyId"),
          status: status.success && statusParam ? status.data : null,
        },
      },
    },
  });

  const header = [
    "رقم الطلب",
    "الشركة",
    "المول",
    "المبلغ المطلوب",
    "المدفوع",
    "المتبقي",
    "الحالة",
    "تاريخ الطلب",
    "موعد التسديد",
    "ملاحظات المندوب",
  ];
  type Row = Prisma.PaymentRequestGetPayload<{
    include: { company: true; mall: true; payments: true };
  }>;

  function lineFor(row: Row): string {
    const requested = toCents(row.amount) ?? 0n;
    const paid = row.payments.reduce(
      (sum, payment) => sum + (toCents(payment.amount) ?? 0n),
      0n,
    );
    const remaining = requested > paid ? requested - paid : 0n;
    return [
      row.reference,
      row.companyName ?? row.company?.name ?? "غير محدد",
      row.mall?.name ?? "غير محدد",
      fromCents(requested),
      fromCents(paid),
      fromCents(remaining),
      row.status,
      row.requestedAt.toISOString(),
      row.appointmentAt?.toISOString() ?? "",
      row.representativeNote ?? "",
    ]
      .map(csv)
      .join(",");
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode("\uFEFF" + header.map(csv).join(",") + "\r\n"),
      );
      try {
        let cursor: string | undefined;
        for (;;) {
          const batch = await prisma.paymentRequest.findMany({
            where,
            include: { company: true, mall: true, payments: true },
            orderBy,
            take: EXPORT_BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (batch.length === 0) break;
          for (const row of batch) {
            controller.enqueue(encoder.encode(lineFor(row) + "\r\n"));
          }
          cursor = batch[batch.length - 1].id;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="mallpay-report.csv"',
      "Cache-Control": "no-store",
    },
  });
}
