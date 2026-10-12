import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-url";
import { currentAdmin } from "@/lib/auth";

export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415,
  ) {
    super(message);
  }
}

export async function readRawBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength))
      throw new RequestBodyError("طول المحتوى غير صالح", 400);
    if (Number(declaredLength) > maxBytes)
      throw new RequestBodyError("حجم الطلب أكبر من المسموح", 413);
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyError("حجم الطلب أكبر من المسموح", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJsonBody(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType?.trim().toLowerCase() !== "application/json")
    throw new RequestBodyError("يجب إرسال البيانات بصيغة JSON", 415);

  const bytes = await readRawBodyLimited(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestBodyError("صيغة JSON غير صالحة", 400);
  }
}

export function isRequestBodyError(error: unknown): error is RequestBodyError {
  return error instanceof RequestBodyError;
}

export function invalidInputResponse(error: unknown, fallback: string) {
  return NextResponse.json(
    { error: isRequestBodyError(error) ? error.message : fallback },
    { status: isRequestBodyError(error) ? error.status : 400 },
  );
}

export function sameOriginError(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json(
      { error: "مصدر الطلب غير مسموح" },
      { status: 403 },
    );
  }

  try {
    if (new URL(origin).origin !== appOrigin(request.nextUrl.origin)) {
      return NextResponse.json(
        { error: "مصدر الطلب غير مسموح" },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "تعذر التحقق من مصدر الطلب" },
      { status: 403 },
    );
  }
  return null;
}

export async function requireAdmin() {
  const admin = await currentAdmin();
  if (!admin)
    return {
      admin: null,
      response: NextResponse.json(
        { error: "غير مصرح. سجّل الدخول أولاً." },
        { status: 401 },
      ),
    };
  return { admin, response: null };
}

export async function requireAdminMutation(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth;

  const originError = sameOriginError(request);
  if (originError) return { admin: null, response: originError };
  return auth;
}

export function errorResponse(error: unknown) {
  if (error && typeof error === "object" && "issues" in error)
    return NextResponse.json(
      { error: "البيانات المدخلة غير صحيحة" },
      { status: 400 },
    );
  return NextResponse.json(
    { error: "حدث خطأ أثناء تنفيذ الطلب" },
    { status: 500 },
  );
}
