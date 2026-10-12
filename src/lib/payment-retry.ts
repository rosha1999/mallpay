export function shouldRotatePaymentKey(
  status: number,
  code: unknown,
): boolean {
  return (
    status < 500 &&
    status !== 429 &&
    code !== "RETRY_SAME_KEY" &&
    code !== "IDEMPOTENCY_KEY_MISMATCH"
  );
}
