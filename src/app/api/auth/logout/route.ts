import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-url";
import { clearSession } from "@/lib/auth";
import { sameOriginError } from "@/lib/http";

export async function POST(request: NextRequest) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  await clearSession();
  try {
    return NextResponse.redirect(
      new URL("/login", appOrigin(request.nextUrl.origin)),
      303,
    );
  } catch {
    return NextResponse.json(
      { error: "يجب ضبط APP_URL كرابط HTTPS في إعدادات النشر" },
      { status: 500 },
    );
  }
}
