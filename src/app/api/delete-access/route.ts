import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  errorResponse,
  invalidInputResponse,
  readJsonBody,
  requireAdmin,
  requireAdminMutation,
} from "@/lib/http";
import {
  DELETE_ACCESS_COOKIE,
  DELETE_ACCESS_TTL_SECONDS,
  createDeleteAccessToken,
  deleteCodeMatches,
  expectedDeleteCode,
  verifyDeleteAccessToken,
} from "@/lib/delete-access";
import { consumeRateLimit } from "@/lib/rate-limit";

const schema = z.object({ code: z.string().trim().min(1).max(64) });

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const configured = expectedDeleteCode() !== null;
  const unlocked =
    configured &&
    verifyDeleteAccessToken(req.cookies.get(DELETE_ACCESS_COOKIE)?.value);
  return NextResponse.json({ configured, unlocked });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminMutation(req);
  if (auth.response) return auth.response;

  const expected = expectedDeleteCode();
  if (!expected) {
    return NextResponse.json(
      { error: "رمز تبويب الحذف غير مضبوط على الخادم" },
      { status: 500 },
    );
  }

  let code: string;
  try {
    ({ code } = schema.parse(await readJsonBody(req)));
  } catch (error) {
    return invalidInputResponse(error, "الرمز غير صالح");
  }

  try {
    const limit = await consumeRateLimit(
      `delete-access:${auth.admin!.id}`,
      5,
      15 * 60 * 1000,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "محاولات كثيرة. حاول مرة أخرى بعد قليل." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }

    if (!deleteCodeMatches(code, expected)) {
      return NextResponse.json(
        { error: "الرمز غير صحيح" },
        { status: 401 },
      );
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(DELETE_ACCESS_COOKIE, createDeleteAccessToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: DELETE_ACCESS_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdminMutation(req);
  if (auth.response) return auth.response;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(DELETE_ACCESS_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
