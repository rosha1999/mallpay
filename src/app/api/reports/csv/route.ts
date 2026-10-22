import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

  const rows = await prisma.paymentRequest.findMany({
    where: {
      ...(fromDate || toDateExclusive
        ? {
            requestedAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDateExclusive ? { lt: toDateExclusive } : {}),
            },
          }
        : {}),
      ...(params.get("mallId") ? { mallId: params.get("mallId")! } : {}),
      ...(params.get("companyId")
        ? { companyId: params.get("companyId")! }
        : {}),
      ...(status.success && statusParam ? { status: status.data } : {}),
    },
    include: { company: true, mall: true, payments: true },
    orderBy: { requestedAt: "desc" },
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
  const lines = rows.map((row) => {
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
  });

  return new NextResponse(
    "\uFEFF" + [header.map(csv).join(","), ...lines].join("\r\n"),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="mallpay-report.csv"',
        "Cache-Control": "no-store",
      },
    },
  );
}
