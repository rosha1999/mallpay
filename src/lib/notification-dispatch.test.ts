import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  channel: "WHATSAPP" | "EMAIL" | "IN_APP";
  recipient: string | null;
  message: string;
  deliveryStatus: "QUEUED" | "PROCESSING" | "SENT" | "FAILED";
  attempts: number;
  lastError: string | null;
  providerMessageId: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const { rows } = vi.hoisted(() => ({ rows: [] as Row[] }));

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === "channel" && typeof value === "object" && value !== null) {
      const cond = value as { in?: string[] };
      if (cond.in && !cond.in.includes(row.channel)) return false;
    } else if (key === "updatedAt" && typeof value === "object" && value !== null) {
      const cond = value as { lt?: Date };
      if (cond.lt && !(row.updatedAt < cond.lt)) return false;
    } else if ((row as unknown as Record<string, unknown>)[key] !== value) {
      return false;
    }
  }
  return true;
}

function applyData(row: Row, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (
      key === "attempts" &&
      typeof value === "object" &&
      value !== null &&
      "increment" in value
    ) {
      row.attempts += (value as { increment: number }).increment;
    } else {
      (row as unknown as Record<string, unknown>)[key] = value;
    }
  }
  row.updatedAt = new Date();
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      findMany: vi.fn(
        async ({
          where,
          orderBy,
          take,
        }: {
          where: Record<string, unknown>;
          orderBy?: { createdAt?: string };
          take?: number;
        }) => {
          const out = rows.filter((r) => matches(r, where));
          if (orderBy?.createdAt === "asc")
            out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          return take ? out.slice(0, take) : out;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const row of rows) {
            if (matches(row, where)) {
              applyData(row, data);
              count++;
            }
          }
          return { count };
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = rows.find((r) => r.id === where.id);
          if (row) applyData(row, data);
          return row;
        },
      ),
    },
  },
}));

import { runNotificationDispatch } from "./notification-dispatch";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function gateway(send: { status: number; body: unknown }) {
  fetchMock.mockImplementation(async (url: unknown) => {
    const u = String(url);
    if (u.endsWith("/api/sessions"))
      return jsonResponse(200, [{ id: "sess-1", name: "mallpay" }]);
    if (u.includes("/messages/send-text")) return jsonResponse(send.status, send.body);
    throw new Error(`Unexpected fetch ${u}`);
  });
}

function sendCalls() {
  return fetchMock.mock.calls.filter(([u]) =>
    String(u).includes("/messages/send-text"),
  ).length;
}

function queuedWhatsApp(id: string, createdAt: string): Row {
  return {
    id,
    channel: "WHATSAPP",
    recipient: "9647722616861",
    message: "appointment",
    deliveryStatus: "QUEUED",
    attempts: 0,
    lastError: null,
    providerMessageId: null,
    sentAt: null,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  };
}

describe("runNotificationDispatch with OpenWA", () => {
  beforeEach(() => {
    rows.length = 0;
    fetchMock.mockReset();
    process.env.OPENWA_BASE_URL = "https://gateway.example.test";
    process.env.OPENWA_API_KEY = "k".repeat(40);
    delete process.env.OPENWA_SESSION_NAME;
  });

  it("sends a queued WhatsApp notification when the session is active", async () => {
    rows.push(queuedWhatsApp("n1", "2026-11-08T00:00:00Z"));
    gateway({ status: 200, body: { id: "wamid.123" } });

    const summary = await runNotificationDispatch();

    expect(summary.providersConfigured).toBe(true);
    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(0);
    expect(rows[0].deliveryStatus).toBe("SENT");
    expect(rows[0].providerMessageId).toBe("wamid.123");
  });

  it("returns the notification to the queue when the session is not active", async () => {
    rows.push(queuedWhatsApp("n1", "2026-11-08T00:00:00Z"));
    gateway({
      status: 400,
      body: {
        message: "Session 'sess-1' is not active. Start the session first.",
      },
    });

    const summary = await runNotificationDispatch();

    expect(summary.sent).toBe(0);
    expect(summary.failed).toBe(0);
    expect(rows[0].deliveryStatus).toBe("QUEUED");
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].lastError).toContain("not active");
  });

  it("stops the batch after the first not-ready failure", async () => {
    rows.push(queuedWhatsApp("n1", "2026-11-08T00:00:00Z"));
    rows.push(queuedWhatsApp("n2", "2026-11-08T00:01:00Z"));
    gateway({
      status: 400,
      body: {
        message: "Session 'sess-1' is not active. Start the session first.",
      },
    });

    const summary = await runNotificationDispatch();

    expect(summary.failed).toBe(0);
    expect(sendCalls()).toBe(1);
    expect(rows[0].deliveryStatus).toBe("QUEUED");
    expect(rows[0].attempts).toBe(1);
    expect(rows[1].deliveryStatus).toBe("QUEUED");
    expect(rows[1].attempts).toBe(0);
  });

  it("still marks the notification FAILED for a final send error", async () => {
    rows.push(queuedWhatsApp("n1", "2026-11-08T00:00:00Z"));
    gateway({ status: 400, body: { message: "Invalid chat id" } });

    const summary = await runNotificationDispatch();

    expect(summary.failed).toBe(1);
    expect(rows[0].deliveryStatus).toBe("FAILED");
    expect(rows[0].lastError).toContain("Invalid chat id");
  });
});
