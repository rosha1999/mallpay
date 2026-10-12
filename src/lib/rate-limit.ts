import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

let lastCleanupAt = 0;

export function clientIdentifier(request: NextRequest): string | null {
  const trustedHeader = process.env.RATE_LIMIT_TRUSTED_IP_HEADER?.toLowerCase();
  if (trustedHeader !== "x-real-ip") return null;

  const address = request.headers.get(trustedHeader)?.trim();
  if (!address || !isIP(address)) return null;
  return createHash("sha256").update(address).digest("hex");
}

function bucketKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  const windowStartedAt = new Date(Math.floor(now / windowMs) * windowMs);
  const hashedKey = bucketKey(key);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStartedAt", "count", "updatedAt")
    VALUES (${hashedKey}, ${windowStartedAt}, 1, ${new Date(now)})
    ON CONFLICT ("key") DO UPDATE SET
      "windowStartedAt" = GREATEST("RateLimitBucket"."windowStartedAt", EXCLUDED."windowStartedAt"),
      "count" = CASE
        WHEN "RateLimitBucket"."windowStartedAt" < EXCLUDED."windowStartedAt" THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "count"
  `;

  if (now - lastCleanupAt > 60 * 60 * 1000) {
    lastCleanupAt = now;
    void prisma.rateLimitBucket
      .deleteMany({
        where: { updatedAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } },
      })
      .catch(() => undefined);
  }

  return {
    allowed: Number(rows[0]?.count ?? limit + 1) <= limit,
    retryAfter: Math.max(
      1,
      Math.ceil((windowStartedAt.getTime() + windowMs - now) / 1000),
    ),
  };
}

export async function clearRateLimit(key: string): Promise<void> {
  await prisma.rateLimitBucket.deleteMany({ where: { key: bucketKey(key) } });
}
