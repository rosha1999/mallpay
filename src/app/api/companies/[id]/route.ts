import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  invalidInputResponse,
  readJsonBody,
  requireAdminMutation,
} from "@/lib/http";
import { phoneNumberSchema } from "@/lib/phone";

const schema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    contactName: z.string().trim().max(120).nullable().optional(),
    phone: z.union([phoneNumberSchema, z.literal(""), z.null()]).optional(),
    email: z
      .union([z.string().trim().email().max(254), z.literal(""), z.null()])
      .optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined));

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminMutation(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  let data: z.infer<typeof schema>;
  try {
    data = schema.parse(await readJsonBody(request));
  } catch (error) {
    return invalidInputResponse(error, "بيانات الشركة غير صالحة");
  }

  try {
    const company = await prisma.$transaction(async (tx) => {
      const existing = await tx.company.findUnique({
        where: { id },
        select: { id: true, mallId: true, active: true },
      });
      if (!existing) throw new Error("NOT_FOUND");
      if (data.active === true) {
        const activeMall = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Mall" WHERE "id" = ${existing.mallId} AND "active" = true FOR SHARE
        `;
        if (!activeMall.length) throw new Error("MALL_INACTIVE");
      }

      const updated = await tx.company.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.contactName !== undefined
            ? { contactName: data.contactName || null }
            : {}),
          ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
          ...(data.email !== undefined ? { email: data.email || null } : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
      });
      if (data.active === false) {
        await tx.companyToken.updateMany({
          where: { companyId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.auditLog.create({
        data: {
          adminId: auth.admin!.id,
          action:
            data.active === undefined
              ? "UPDATE_COMPANY"
              : data.active
                ? "ENABLE_COMPANY"
                : "DISABLE_COMPANY",
          entityType: "Company",
          entityId: id,
          metadata: { changedFields: Object.keys(data) },
        },
      });
      return updated;
    });
    return NextResponse.json(company);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND")
      return NextResponse.json({ error: "الشركة غير موجودة" }, { status: 404 });
    if (error instanceof Error && error.message === "MALL_INACTIVE")
      return NextResponse.json(
        { error: "فعّل المول أولاً قبل إعادة تفعيل الشركة." },
        { status: 409 },
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return NextResponse.json(
        { error: "يوجد اسم الشركة نفسه ضمن هذا المول." },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "تعذر تحديث الشركة حالياً." },
      { status: 500 },
    );
  }
}
