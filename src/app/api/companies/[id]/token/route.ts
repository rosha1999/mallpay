import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import { requireAdminMutation } from "@/lib/http";

const linkLifetimeMs = 90 * 24 * 60 * 60 * 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminMutation(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  let origin: string;
  try {
    origin = appOrigin(request.nextUrl.origin);
  } catch {
    return NextResponse.json(
      { error: "يجب ضبط APP_URL كرابط HTTPS قبل إصدار الروابط." },
      { status: 500 },
    );
  }

  const company = await prisma.company.findUnique({
    where: { id },
    select: { id: true, active: true, mallId: true, mall: { select: { active: true } } },
  });
  if (!company)
    return NextResponse.json({ error: "الشركة غير موجودة" }, { status: 404 });
  if (!company.active || !company.mall.active)
    return NextResponse.json(
      { error: "فعّل الشركة والمول أولاً قبل إصدار الرابط." },
      { status: 409 },
    );

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + linkLifetimeMs);
  try {
    await prisma.$transaction(async (tx) => {
      const activeMall = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Mall" WHERE "id" = ${company.mallId} AND "active" = true FOR SHARE
      `;
      if (!activeMall.length) throw new Error("INACTIVE_MALL");
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${id} FOR UPDATE`;
      const activeCompany = await tx.company.findUnique({
        where: { id },
        select: { active: true },
      });
      if (!activeCompany?.active) throw new Error("INACTIVE_COMPANY");
      await tx.companyToken.updateMany({
        where: { companyId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.companyToken.create({
        data: {
          companyId: id,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          adminId: auth.admin!.id,
          action: "ROTATE_PUBLIC_LINK",
          entityType: "Company",
          entityId: id,
          metadata: { expiresAt: expiresAt.toISOString() },
        },
      });
    });
    return NextResponse.json({
      publicLink: `${origin}/company/${token}`,
      expiresAt,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["INACTIVE_MALL", "INACTIVE_COMPANY"].includes(error.message)
    )
      return NextResponse.json(
        { error: "فعّل الشركة والمول أولاً قبل إصدار الرابط." },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "تعذر إصدار رابط جديد حالياً" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminMutation(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!company)
    return NextResponse.json({ error: "الشركة غير موجودة" }, { status: 404 });

  const now = new Date();
  try {
    const revoked = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${id} FOR UPDATE`;
      const result = await tx.companyToken.updateMany({
        where: { companyId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.auditLog.create({
        data: {
          adminId: auth.admin!.id,
          action: "REVOKE_PUBLIC_LINK",
          entityType: "Company",
          entityId: id,
          metadata: { revokedCount: result.count },
        },
      });
      return result.count;
    });
    return NextResponse.json({ revoked });
  } catch {
    return NextResponse.json(
      { error: "تعذر إلغاء الرابط حالياً" },
      { status: 500 },
    );
  }
}
