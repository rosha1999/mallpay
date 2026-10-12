export function appOrigin(fallbackOrigin?: string): string {
  const configured = process.env.APP_URL?.trim();
  const value =
    configured ||
    (process.env.NODE_ENV === "production" ? undefined : fallbackOrigin);
  if (!value) throw new Error("APP_URL must be configured in production");

  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  ) {
    throw new Error("APP_URL must be a valid HTTP origin");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("APP_URL must use HTTPS in production");
  }
  return url.origin;
}
