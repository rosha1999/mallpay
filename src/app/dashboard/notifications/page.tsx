"use client";

import { useCallback, useEffect, useState } from "react";
import { formatBaghdadDateTime } from "@/lib/dates";

type InboxItem = {
  id: string;
  requestId: string | null;
  message: string;
  readAt: string | null;
  createdAt: string;
};

export default function Notifications() {
  const [rows, setRows] = useState<InboxItem[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/notifications?limit=100");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تعذر تحميل الإشعارات");
      setRows(result.rows as InboxItem[]);
      setUnreadTotal(result.unreadTotal as number);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "تعذر تحميل الإشعارات",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : { all: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تعذر تحديث الإشعار");
      const readAt = new Date().toISOString();
      setRows((current) =>
        current.map((row) =>
          !id || row.id === id ? { ...row, readAt } : row,
        ),
      );
      setUnreadTotal((current) => Math.max(0, current - result.updated));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "تعذر تحديث الإشعار",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panelhead">
        <div>
          <h2 className="title">صندوق الإشعارات</h2>
          <p className="muted">إشعارات الطلبات والإجراءات الإدارية</p>
        </div>
        <button
          className="btn secondary"
          type="button"
          disabled={busy || unreadTotal === 0}
          onClick={() => void markRead()}
        >
          تعليم الكل كمقروء
        </button>
      </div>
      {unreadTotal > 0 && (
        <p className="muted" role="status">
          لديك {unreadTotal} إشعاراً غير مقروء
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel notification-list" aria-live="polite">
        {loading && <p className="muted">جارٍ تحميل الإشعارات…</p>}
        {!loading && !rows.length && !error && (
          <p className="muted">لا توجد إشعارات حالياً.</p>
        )}
        {rows.map((row) => (
          <article
            key={row.id}
            className={`notification-item ${row.readAt ? "" : "unread"}`}
          >
            <div>
              <p className="notification-message">{row.message}</p>
              <time className="muted" dateTime={row.createdAt}>
                {formatBaghdadDateTime(row.createdAt)}
              </time>
            </div>
            {!row.readAt ? (
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={() => void markRead(row.id)}
              >
                مقروء
              </button>
            ) : (
              <span className="badge green">مقروء</span>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
