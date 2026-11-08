import { randomUUID } from "node:crypto";

// OpenWA (self-hosted WhatsApp gateway) provider configuration.
//
// When OPENWA_BASE_URL and OPENWA_API_KEY are set, MallPay sends WhatsApp
// notifications through a locally hosted OpenWA instance (reached over a
// secure tunnel) instead of the Meta Cloud API. The API key must be scoped
// to the session named by OPENWA_SESSION_NAME (default "mallpay") and must
// never be an IP-allowlisted key — Vercel egress addresses change.

export type OpenWaConfig = {
  baseUrl: string;
  apiKey: string;
  sessionName: string;
};

export function openWaConfig(
  env: Record<string, string | undefined> = process.env,
): OpenWaConfig | null {
  const rawBaseUrl = env.OPENWA_BASE_URL?.trim();
  const apiKey = env.OPENWA_API_KEY?.trim();
  const sessionName = env.OPENWA_SESSION_NAME?.trim() || "mallpay";
  if (!rawBaseUrl || !apiKey || apiKey.length < 16) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(sessionName)) return null;
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const isLocalHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) return null;
  const baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return { baseUrl, apiKey, sessionName };
}

export function openWaChatId(internationalDigits: string): string {
  return `${internationalDigits}@c.us`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function pickOpenWaSessionId(
  payload: unknown,
  sessionName: string,
): string | null {
  const root = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.sessions)
        ? root.sessions
        : [];
  for (const entry of list) {
    const session = asRecord(entry);
    if (!session) continue;
    if (session.name === sessionName) {
      const id = stringField(session, "id");
      if (id) return id;
    }
  }
  return null;
}

export function openWaProviderMessageId(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  const message = asRecord(root.message);
  const data = asRecord(root.data);
  const candidates: unknown[] = [
    asRecord(root.id)?._serialized,
    root.messageId,
    root.id,
    message ? asRecord(message.id)?._serialized : null,
    message?.id,
    data ? asRecord(data.id)?._serialized : null,
    data?.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

export class OpenWaRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "OpenWaRequestError";
    this.status = status;
  }
}

// Whether a failed OpenWA call means "not ready right now" (worth retrying
// on a later run) rather than "this message can never be sent". Covers: no
// answer at all (network error or timeout), gateway-side 5xx and rate
// limiting, a session that no longer exists, and a session that exists but
// is not active — e.g. it did not come back after the host PC restarted.
export function isRetryableOpenWaError(error: unknown): boolean {
  if (!(error instanceof OpenWaRequestError)) return false;
  if (error.status === null) return true;
  if (error.status >= 500 || error.status === 429 || error.status === 404)
    return true;
  if (error.status === 400) {
    const message = error.message.toLowerCase();
    return (
      message.includes("not active") ||
      message.includes("start the session") ||
      message.includes("not ready") ||
      message.includes("not connected")
    );
  }
  return false;
}

async function openWaRequest(
  config: OpenWaConfig,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        "X-API-Key": config.apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new OpenWaRequestError(
      `OpenWA request failed: ${e instanceof Error ? e.message : "network error"}`,
      null,
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = asRecord(data);
    const detail =
      (record && (stringField(record, "message") ?? stringField(record, "error"))) ||
      null;
    throw new OpenWaRequestError(
      `OpenWA HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      response.status,
    );
  }
  return data;
}

export async function resolveOpenWaSessionId(
  config: OpenWaConfig,
): Promise<string> {
  const data = await openWaRequest(config, "/api/sessions", { method: "GET" });
  const id = pickOpenWaSessionId(data, config.sessionName);
  if (!id)
    throw new Error(`OpenWA session "${config.sessionName}" was not found`);
  return id;
}

export async function sendOpenWaTextMessage(
  config: OpenWaConfig,
  sessionId: string,
  recipientDigits: string,
  text: string,
): Promise<string> {
  const data = await openWaRequest(
    config,
    `/api/sessions/${encodeURIComponent(sessionId)}/messages/send-text`,
    {
      method: "POST",
      body: JSON.stringify({ chatId: openWaChatId(recipientDigits), text }),
    },
  );
  // The gateway accepted the send; if its response carries no message id,
  // record a local one so the notification can still be marked SENT.
  return openWaProviderMessageId(data) ?? `openwa:${randomUUID()}`;
}
