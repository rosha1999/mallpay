import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  invalidInputResponse,
  readJsonBody,
  requireAdminMutation,
} from "@/lib/http";
import { formatBaghdadDateTime } from "@/lib/dates";
import { normalizePhoneNumber } from "@/lib/phone";
import { futureAppointmentAtSchema } from "@/lib/appointments";
const schema = z.object({
  appointmentAt: futureAppointmentAtSchema,
  note: z.string().max(1000).optional(),
  status: z.enum(["APPROVED", "RESCHEDULED"]).default("APPROVED"),
});
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminMutation(req);
  if (auth.response) return auth.response;
  const { id } = await params;

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await readJsonBody(req));
  } catch (error) {
    return invalidInputResponse(error, "بيانات الموعد غير صالحة");
  }

  const scheduledAt = new Date(body.appointmentAt);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PaymentRequest" WHERE "id" = ${id} FOR UPDATE`;
      const existing = await tx.paymentRequest.findUnique({
        where: { id },
        include: { company: true },
      });
      if (!existing) throw new Error("NOT_FOUND");
      if (["REJECTED", "CANCELLED", "PAID"].includes(existing.status))
        throw new Error("CONFLICT");

      const activeAppointment = await tx.appointment.findFirst({
        where: { requestId: existing.id, status: "SCHEDULED" },
        orderBy: { createdAt: "desc" },
      });
      const recipient =
        normalizePhoneNumber(existing.representativePhone ?? "") ??
        normalizePhoneNumber(existing.company.phone ?? "");
      if (
        existing.appointmentAt?.getTime() === scheduledAt.getTime() &&
        activeAppointment?.scheduledAt.getTime() === scheduledAt.getTime() &&
        activeAppointment?.note === (body.note ?? null)
      )
        return { request: existing, queuedWhatsapp: Boolean(recipient) };

      const changed = await tx.paymentRequest.updateMany({
        where: {
          id,
          status: { notIn: ["REJECTED", "CANCELLED", "PAID"] },
        },
        data: {
          appointmentAt: scheduledAt,
          dueAt: scheduledAt,
          status: body.status,
          note: body.note ?? existing.note,
        },
      });
      if (changed.count !== 1) throw new Error("CONFLICT");
      const updated = await tx.paymentRequest.findUniqueOrThrow({
        where: { id },
      });

      await tx.appointment.updateMany({
        where: { requestId: existing.id, status: "SCHEDULED" },
        data: { status: "RESCHEDULED" },
      });
      const appointment = await tx.appointment.create({
        data: {
          companyId: existing.companyId,
          requestId: existing.id,
          scheduledAt,
          status: "SCHEDULED",
          note: body.note,
        },
      });
      if (recipient) {
        await tx.notification.create({
          data: {
            requestId: existing.id,
            adminId: auth.admin!.id,
            channel: "WHATSAPP",
            deliveryStatus: "QUEUED",
            recipient,
            message: `تم تحديد موعد طلب ${existing.reference} بتاريخ ${formatBaghdadDateTime(scheduledAt)}`,
            dedupeKey: `request:${existing.id}:appointment:${appointment.id}`,
          },
        });
      }
      if (existing.company.email) {
        await tx.notification.create({
          data: {
            requestId: existing.id,
            channel: "EMAIL",
            deliveryStatus: "QUEUED",
            recipient: existing.company.email,
            message: `تم تحديد موعد طلب ${existing.reference} بتاريخ ${formatBaghdadDateTime(scheduledAt)}.`,
            dedupeKey: `request:${existing.id}:email:appointment:${appointment.id}`,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          adminId: auth.admin!.id,
          action: body.status === "RESCHEDULED" ? "RESCHEDULE" : "APPROVE",
          entityType: "PaymentRequest",
          entityId: existing.id,
          metadata: { appointmentAt: scheduledAt.toISOString() },
        },
      });
      return { request: updated, queuedWhatsapp: Boolean(recipient) };
    });
    return NextResponse.json({
      ok: true,
      request: result.request,
      message: result.queuedWhatsapp
        ? "تم حفظ الموعد وإضافة إشعار WhatsApp إلى قائمة الإرسال. يجب تشغيل العامل وإعداد حساب Meta لإرسال الرسالة فعلياً."
        : "تم حفظ الموعد، لكن لا يوجد رقم هاتف صالح لإرسال إشعار WhatsApp.",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "NOT_FOUND" ? 404 : code === "CONFLICT" ? 409 : 500;
    return NextResponse.json(
      {
        error:
          code === "NOT_FOUND"
            ? "الطلب غير موجود"
            : code === "CONFLICT"
              ? "لا يمكن تحديد موعد لهذا الطلب بحالته الحالية"
              : "تعذر حفظ الموعد حالياً",
      },
      { status },
    );
  }
}
