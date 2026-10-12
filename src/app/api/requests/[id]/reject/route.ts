import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  invalidInputResponse,
  readJsonBody,
  requireAdminMutation,
} from "@/lib/http";
const schema = z.object({ reason: z.string().trim().min(2).max(1000) });
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminMutation(req);
  if (auth.response) return auth.response;
  const { id } = await params;

  let reason: string;
  try {
    ({ reason } = schema.parse(await readJsonBody(req)));
  } catch (error) {
    return invalidInputResponse(error, "سبب الرفض غير صالح");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PaymentRequest" WHERE "id" = ${id} FOR UPDATE`;
      const request = await tx.paymentRequest.findUnique({
        where: { id },
        include: { payments: true },
      });
      if (!request) throw new Error("NOT_FOUND");
      if (request.status === "REJECTED" && request.note === reason)
        return request;
      if (
        request.status === "PAID" ||
        request.status === "CANCELLED" ||
        request.status === "REJECTED" ||
        request.payments.length
      )
        throw new Error("CONFLICT");
      const changed = await tx.paymentRequest.updateMany({
        where: {
          id,
          status: { notIn: ["PAID", "CANCELLED", "REJECTED"] },
        },
        data: { status: "REJECTED", note: reason },
      });
      if (changed.count !== 1) throw new Error("CONFLICT");
      const updated = await tx.paymentRequest.findUniqueOrThrow({
        where: { id },
      });
      await tx.appointment.updateMany({
        where: { requestId: id, status: "SCHEDULED" },
        data: { status: "CANCELLED" },
      });
      await tx.notification.create({
        data: {
          requestId: id,
          adminId: auth.admin!.id,
          channel: "IN_APP",
          deliveryStatus: "QUEUED",
          message: `تم رفض الطلب ${request.reference}: ${reason}`,
          dedupeKey: `request:${id}:rejected`,
        },
      });
      await tx.auditLog.create({
        data: {
          adminId: auth.admin!.id,
          action: "REJECT",
          entityType: "PaymentRequest",
          entityId: id,
          metadata: { reason },
        },
      });
      return updated;
    });
    return NextResponse.json({ ok: true, request: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return NextResponse.json(
      {
        error:
          msg === "NOT_FOUND"
            ? "الطلب غير موجود"
            : msg === "CONFLICT"
              ? "لا يمكن رفض طلب مدفوع أو ملغى أو عليه دفعات"
              : "تعذر رفض الطلب",
      },
      { status: msg === "NOT_FOUND" ? 404 : msg === "CONFLICT" ? 409 : 500 },
    );
  }
}
