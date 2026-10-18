import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdminMutation } from "@/lib/http";

const linkLifetimeMs = 90 * 24 * 60 * 60 * 1000;

export async function GET() {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const token = await prisma.companyToken.findFirst({
    where: {
      companyId: null,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { createdAt: true, expiresAt: true, revokedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ token });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminMutation(request);
  if (auth.response) return auth.response;

  let origin: string;
  try {
    origin = appOrigin(request.nextUrl.origin);
  } catch {
    return NextResponse.json(
      { error: "يجب ضبط APP_URL كرابط HTTPS قبل إصدار الروابط." },
      { status: 500 },
    );
  }

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + linkLifetimeMs);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.companyToken.updateMany({
        where: { companyId: null, revokedAt: null },
        data: { revokedAt: now },
      });
      const created = await tx.companyToken.create({
        data: {
          companyId: null,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          adminId: auth.admin!.id,
          action: "ROTATE_ALL_COMPANIES_PUBLIC_LINK",
          entityType: "CompanyToken",
          entityId: created.id,
          metadata: { expiresAt: expiresAt.toISOString() },
        },
      });
    });
    return NextResponse.json({
      publicLink: `${origin}/company/${token}`,
      expiresAt,
    });
  } catch {
    return NextResponse.json(
      { error: "تعذر إصدار رابط جديد حالياً" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminMutation(request);
  if (auth.response) return auth.response;

  try {
    const revoked = await prisma.$transaction(async (tx) => {
      const result = await tx.companyToken.updateMany({
        where: { companyId: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          adminId: auth.admin!.id,
          action: "REVOKE_ALL_COMPANIES_PUBLIC_LINK",
          entityType: "CompanyToken",
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
