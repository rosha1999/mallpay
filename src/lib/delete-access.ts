import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Extra code gate for the delete-requests tab. The code itself lives only
// in the DELETE_REQUESTS_CODE environment variable; a correct entry mints
// a short-lived HMAC-signed cookie (signed with AUTH_SECRET) that the
// DELETE /api/requests/[id] endpoint requires.

export const DELETE_ACCESS_COOKIE = "mallpay_delete_unlock";
export const DELETE_ACCESS_TTL_SECONDS = 30 * 60;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not configured");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret())
    .update(`delete-access:${payload}`)
    .digest("base64url");
}

export function createDeleteAccessToken(now = Date.now()): string {
  const exp = Math.floor(now / 1000) + DELETE_ACCESS_TTL_SECONDS;
  return `${exp}.${sign(String(exp))}`;
}

export function verifyDeleteAccessToken(
  token: string | undefined,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const [expRaw, signature] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp) || !signature) return false;
  if (exp < Math.floor(now / 1000)) return false;
  const expected = sign(String(exp));
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function expectedDeleteCode(): string | null {
  const code = process.env.DELETE_REQUESTS_CODE?.trim();
  return code ? code : null;
}

export function deleteCodeMatches(candidate: string, expected: string): boolean {
  const digest = (value: string) =>
    createHash("sha256").update(value).digest();
  const a = digest(candidate);
  const b = digest(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
