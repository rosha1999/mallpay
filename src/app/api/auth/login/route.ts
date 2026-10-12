import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import {
  invalidInputResponse,
  readJsonBody,
  sameOriginError,
} from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { verifyAdminPassword } from "@/lib/passwords";
import {
  clearRateLimit,
  clientIdentifier,
  consumeRateLimit,
} from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});
const windowMs = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await readJsonBody(request));
  } catch (error) {
    return invalidInputResponse(error, "بيانات تسجيل الدخول غير صالحة");
  }

  try {
    const email = body.email.toLowerCase();
    const client = clientIdentifier(request);
    const emailHash = createHash("sha256").update(email).digest("hex");
    const keys: string[] = [];
    const checks: Promise<Awaited<ReturnType<typeof consumeRateLimit>>>[] = [];
    if (client) {
      const ipKey = `login:ip:${client}`;
      const pairKey = `login:pair:${client}:${emailHash}`;
      keys.push(ipKey, pairKey);
      checks.push(
        consumeRateLimit(ipKey, 30, windowMs),
        consumeRateLimit(pairKey, 8, windowMs),
      );
    }
    const emailKey = `login:email:${emailHash}`;
    keys.push(emailKey);
    checks.push(consumeRateLimit(emailKey, 40, 60 * 60 * 1000));
    const results = await Promise.all(checks);
    const blocked = results.find((result) => !result.allowed);
    if (blocked) {
      return NextResponse.json(
        { error: "تم تجاوز عدد محاولات الدخول. حاول مرة أخرى بعد قليل." },
        { status: 429, headers: { "Retry-After": String(blocked.retryAfter) } },
      );
    }

    const admin = await prisma.adminUser.findUnique({ where: { email } });
    const passwordMatches = await verifyAdminPassword(
      body.password,
      admin?.active ? admin.passwordHash : null,
    );
    if (!admin || !admin.active || !passwordMatches) {
      await prisma.auditLog.create({
        data: {
          adminId: admin?.id,
          action: "LOGIN_FAILED",
          entityType: "AdminUser",
          entityId: admin?.id,
          ipAddress: client ?? undefined,
        },
      });
      return NextResponse.json(
        { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" },
        { status: 401 },
      );
    }

    await createSession(admin.id);
    await prisma.auditLog.create({
      data: {
        adminId: admin.id,
        action: "LOGIN",
        entityType: "AdminUser",
        entityId: admin.id,
        ipAddress: client ?? undefined,
      },
    });
    await Promise.all(keys.map(clearRateLimit));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "تعذر تسجيل الدخول حالياً" },
      { status: 500 },
    );
  }
}
