import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  invalidInputResponse,
  readJsonBody,
  requireAdminMutation,
} from "@/lib/http";

const schema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    location: z.string().trim().max(200).nullable().optional(),
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
    return invalidInputResponse(error, "بيانات المول غير صالحة");
  }

  try {
    const mall = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Mall" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.mall.findUnique({ where: { id } });
      if (!current) throw new Error("NOT_FOUND");
      const updated = await tx.mall.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.location !== undefined
            ? { location: data.location || null }
            : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
      });
      if (data.active === false) {
        await tx.companyToken.updateMany({
          where: { company: { mallId: id }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.auditLog.create({
        data: {
          adminId: auth.admin!.id,
          action:
            data.active === undefined
              ? "UPDATE_MALL"
              : data.active
                ? "ENABLE_MALL"
                : "DISABLE_MALL",
          entityType: "Mall",
          entityId: id,
          metadata: { changedFields: Object.keys(data) },
        },
      });
      return updated;
    });
    return NextResponse.json(mall);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND")
      return NextResponse.json({ error: "المول غير موجود" }, { status: 404 });
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return NextResponse.json(
        { error: "يوجد مول بهذا الاسم مسبقاً." },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "تعذر تحديث المول حالياً." },
      { status: 500 },
    );
  }
}
