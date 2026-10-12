import { createHash } from "node:crypto";

export function payloadFingerprint(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
