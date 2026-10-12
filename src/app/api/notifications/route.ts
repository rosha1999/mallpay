import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  invalidInputResponse,
  readJsonBody,
  requireAdmin,
  requireAdminMutation,
} from "@/lib/http";

const markSchema = z
  .union([
    z.object({ id: z.string().min(1) }).strict(),
    z.object({ all: z.literal(true) }).strict(),
  ]);

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const rawLimit = request.nextUrl.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    return NextResponse.json({ error: "عدد الإشعارات غير صالح" }, { status: 400 });

  const where = {
    channel: "IN_APP" as const,
    OR: [{ adminId: null }, { adminId: auth.admin!.id }],
  };
  const [rows, unreadTotal] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        requestId: true,
        message: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return NextResponse.json({ rows, unreadTotal });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminMutation(request);
  if (auth.response) return auth.response;

  let data: z.infer<typeof markSchema>;
  try {
    data = markSchema.parse(await readJsonBody(request));
  } catch (error) {
    return invalidInputResponse(error, "طلب تحديث الإشعار غير صالح");
  }

  const where = {
    channel: "IN_APP" as const,
    readAt: null,
    OR: [{ adminId: null }, { adminId: auth.admin!.id }],
    ...("id" in data ? { id: data.id } : {}),
  };
  const result = await prisma.notification.updateMany({
    where,
    data: { readAt: new Date(), deliveryStatus: "READ" },
  });
  return NextResponse.json({ updated: result.count });
}
