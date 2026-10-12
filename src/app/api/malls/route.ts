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
const schema = z.object({
  name: z.string().trim().min(2).max(100),
  location: z.string().trim().max(200).optional(),
});
export async function GET(request: NextRequest) {
  const a = await requireAdmin();
  if (a.response) return a.response;
  const includeInactive =
    request.nextUrl.searchParams.get("includeInactive") === "true";
  return NextResponse.json(
    await prisma.mall.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    }),
  );
}
export async function POST(req: NextRequest) {
  const a = await requireAdminMutation(req);
  if (a.response) return a.response;
  let d: z.infer<typeof schema>;
  try {
    d = schema.parse(await readJsonBody(req));
  } catch (error) {
    return invalidInputResponse(error, "بيانات المول غير صالحة");
  }

  try {
    const mall = await prisma.$transaction(async (tx) => {
      const created = await tx.mall.create({ data: d });
      await tx.auditLog.create({
        data: {
          adminId: a.admin!.id,
          action: "CREATE",
          entityType: "Mall",
          entityId: created.id,
        },
      });
      return created;
    });
    return NextResponse.json(mall, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return NextResponse.json(
        { error: "يوجد مول بهذا الاسم مسبقاً." },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "تعذر إنشاء المول حالياً." },
      { status: 500 },
    );
  }
}
