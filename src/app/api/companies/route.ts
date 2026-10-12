import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import {
  invalidInputResponse,
  readJsonBody,
  requireAdmin,
  requireAdminMutation,
} from "@/lib/http";
import { phoneNumberSchema } from "@/lib/phone";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  mallId: z.string().min(1),
  contactName: z.string().trim().max(120).optional(),
  phone: z.union([phoneNumberSchema, z.literal("")]).optional(),
  email: z
    .union([z.string().trim().email().max(254), z.literal("")])
    .optional(),
});
const linkLifetimeMs = 90 * 24 * 60 * 60 * 1000;

export async function GET() {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const companies = await prisma.company.findMany({
    include: {
      mall: true,
      tokens: {
        where: {
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { createdAt: true, expiresAt: true, revokedAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(companies);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminMutation(request);
  if (auth.response) return auth.response;

  let origin: string;
  let data: z.infer<typeof schema>;
  try {
    origin = appOrigin(request.nextUrl.origin);
  } catch {
    return NextResponse.json(
      { error: "يجب ضبط APP_URL كرابط HTTPS قبل إنشاء روابط الشركات." },
      { status: 500 },
    );
  }
  try {
    data = schema.parse(await readJsonBody(request));
  } catch (error) {
    return invalidInputResponse(error, "بيانات الشركة غير صالحة");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + linkLifetimeMs);
  try {
    const company = await prisma.$transaction(async (tx) => {
      const activeMall = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Mall" WHERE "id" = ${data.mallId} AND "active" = true FOR SHARE
      `;
      if (!activeMall.length) throw new Error("INACTIVE_MALL");
      const created = await tx.company.create({
        data: {
          ...data,
          phone: data.phone || null,
          email: data.email || null,
        },
      });
      await tx.companyToken.create({
        data: {
          companyId: created.id,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          adminId: auth.admin!.id,
          action: "CREATE",
          entityType: "Company",
          entityId: created.id,
        },
      });
      return created;
    });
    return NextResponse.json(
      { company, publicLink: `${origin}/company/${token}`, expiresAt },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "INACTIVE_MALL")
      return NextResponse.json(
        { error: "لا يمكن إضافة شركة إلى مول متوقف." },
        { status: 409 },
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return NextResponse.json(
        { error: "توجد شركة بهذا الاسم ضمن هذا المول." },
        { status: 409 },
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    )
      return NextResponse.json({ error: "المول المحدد غير موجود." }, { status: 400 });
    return NextResponse.json(
      { error: "تعذر إنشاء الشركة حالياً." },
      { status: 500 },
    );
  }
}
