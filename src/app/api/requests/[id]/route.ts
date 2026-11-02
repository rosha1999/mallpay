import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, requireAdminMutation } from "@/lib/http";
import {
  DELETE_ACCESS_COOKIE,
  expectedDeleteCode,
  verifyDeleteAccessToken,
} from "@/lib/delete-access";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminMutation(req);
  if (auth.response) return auth.response;

  if (!expectedDeleteCode()) {
    return NextResponse.json(
      { error: "رمز تبويب الحذف غير مضبوط على الخادم" },
      { status: 500 },
    );
  }
  if (
    !verifyDeleteAccessToken(req.cookies.get(DELETE_ACCESS_COOKIE)?.value)
  ) {
    return NextResponse.json(
      { error: "أدخل رمز تبويب الحذف أولاً" },
      { status: 403 },
    );
  }

  const { id } = await params;

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PaymentRequest" WHERE "id" = ${id} FOR UPDATE`;
      const request = await tx.paymentRequest.findUnique({
        where: { id },
      });
      if (!request) return null;

      await tx.notification.deleteMany({ where: { requestId: id } });
      await tx.payment.deleteMany({ where: { requestId: id } });
      await tx.appointment.deleteMany({ where: { requestId: id } });
      await tx.paymentRequest.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          adminId: auth.admin!.id,
          action: "DELETE",
          entityType: "PaymentRequest",
          entityId: id,
          metadata: {
            reference: request.reference,
            status: request.status,
            amount: request.amount.toString(),
            companyName: request.companyName ?? null,
          },
        },
      });
      return request;
    });

    if (!deleted) {
      return NextResponse.json(
        { error: "الطلب غير موجود" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
