import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isConfiguredSecret } from "@/lib/secrets";
const COOKIE = "mallpay_session";
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!isConfiguredSecret(s))
    throw new Error(
      "AUTH_SECRET must be a unique secret of at least 32 characters",
    );
  return new TextEncoder().encode(s);
}
export async function createSession(adminId: string) {
  const token = await new SignJWT({ sub: adminId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
}
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
export async function currentAdmin() {
  try {
    const token = (await cookies()).get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return await prisma.adminUser.findFirst({
      where: { id: payload.sub, active: true },
      select: { id: true, name: true, email: true },
    });
  } catch {
    return null;
  }
}
