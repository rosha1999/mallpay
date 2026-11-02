"use client";

import { useCallback, useEffect, useState } from "react";
import { formatBaghdadDateTime } from "@/lib/dates";
import RequestStatusBadge from "@/components/RequestStatusBadge";

type Row = {
  id: string;
  reference: string;
  amount: string;
  appointmentAt: string | null;
  createdAt: string;
  status: string;
  companyName: string | null;
  company: { name: string } | null;
  mall: { name: string } | null;
};
type RequestPage = {
  rows: Row[];
  total: number;
  page: number;
  pageCount: number;
};

const statuses = [
  ["PENDING", "طلب جديد"],
  ["APPROVED", "تم تحديد الموعد"],
  ["RESCHEDULED", "أعيدت الجدولة"],
  ["REJECTED", "مرفوض"],
  ["PAID", "مدفوع"],
  ["CANCELLED", "ملغى"],
] as const;

const money = (n: number) =>
  new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 2 }).format(n) +
  " د.ع";

type Gate = "checking" | "locked" | "unlocked";

export default function DeleteRequestsPage() {
  const [gate, setGate] = useState<Gate>("checking");
  const [configured, setConfigured] = useState(true);
  const [code, setCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (status: string) => {
    setLoading(true);
    setError("");
    try {
      const all: Row[] = [];
      let page = 1;
      let pageCount = 1;
      do {
        const query = new URLSearchParams({ page: String(page) });
        if (status !== "ALL") query.set("status", status);
        const res = await fetch(`/api/requests?${query}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("تعذر تحميل الطلبات");
        const data = (await res.json()) as RequestPage;
        all.push(...data.rows);
        pageCount = data.pageCount;
        page += 1;
      } while (page <= pageCount);
      setRows(all);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "تعذر تحميل الطلبات",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/delete-access", { cache: "no-store" });
        const data = (await res.json()) as {
          configured: boolean;
          unlocked: boolean;
        };
        if (!active) return;
        setConfigured(data.configured);
        setGate(data.unlocked ? "unlocked" : "locked");
      } catch {
        if (active) setGate("locked");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (gate === "unlocked") void load(statusFilter);
  }, [gate, load, statusFilter]);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setUnlocking(true);
    setError("");
    try {
      const res = await fetch("/api/delete-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) throw new Error(data?.error ?? "تعذر فتح التبويب");
      setCode("");
      setGate("unlocked");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر فتح التبويب");
    } finally {
      setUnlocking(false);
    }
  }

  async function lock() {
    await fetch("/api/delete-access", { method: "DELETE" }).catch(
      () => null,
    );
    setRows([]);
    setNotice("");
    setError("");
    setGate("locked");
  }

  async function remove(row: Row) {
    const company = row.companyName ?? row.company?.name ?? "غير محدد";
    if (
      !window.confirm(
        `حذف طلب ${company} بمبلغ ${money(Number(row.amount))} نهائياً؟\n` +
          "سيتم حذف دفعاته ومواعيده وإشعاراته أيضاً، ولا يمكن التراجع عن الحذف.",
      )
    ) {
      return;
    }
    setBusyId(row.id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/requests/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "تعذر حذف الطلب");
      }
      setRows((current) => current.filter((r) => r.id !== row.id));
      setNotice(`تم حذف طلب ${company} بنجاح`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر حذف الطلب");
    } finally {
      setBusyId(null);
    }
  }

  if (gate === "checking") {
    return (
      <>
        <h2 className="title">حذف الطلبات</h2>
        <p className="muted">جارٍ التحقق...</p>
      </>
    );
  }

  if (gate === "locked") {
    return (
      <>
        <h2 className="title">حذف الطلبات</h2>
        <p className="muted">هذا التبويب محمي برمز خاص. أدخل الرمز للمتابعة.</p>
        {!configured && (
          <p className="error" role="alert">
            رمز التبويب غير مضبوط على الخادم بعد. أضف المتغير
            DELETE_REQUESTS_CODE في إعدادات Vercel ثم أعد النشر.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <section className="panel" style={{ maxWidth: 420 }}>
          <form onSubmit={unlock} className="field">
            <label htmlFor="delete-code">رمز تبويب الحذف</label>
            <input
              id="delete-code"
              type="password"
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={unlocking || !configured}
            />
            <button type="submit" className="btn" disabled={unlocking || !configured}>
              {unlocking ? "جارٍ التحقق..." : "فتح التبويب"}
            </button>
          </form>
        </section>
      </>
    );
  }

  return (
    <>
      <h2 className="title">حذف الطلبات</h2>
      <p className="muted">
        من هنا يمكنك حذف أي طلب نهائياً، مع دفعاته ومواعيده وإشعاراته. الحذف
        لا يمكن التراجع عنه، ويبقى التبويب مفتوحاً 30 دقيقة من إدخال الرمز.
      </p>
      <div className="requests-toolbar">
        <label htmlFor="delete-status">تصفية الحالة</label>
        <select
          id="delete-status"
          value={statusFilter}
          disabled={loading || busyId !== null}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="ALL">كل الطلبات</option>
          {statuses.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" className="btn secondary" onClick={() => void lock()}>
          قفل التبويب
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      <section className="panel">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>الشركة</th>
                <th>المول</th>
                <th>المبلغ</th>
                <th>الموعد</th>
                <th>الحالة</th>
                <th>تاريخ الطلب</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={`status-${row.status.toLowerCase()}`}
                >
                  <td>{row.companyName ?? row.company?.name ?? "غير محدد"}</td>
                  <td>{row.mall?.name ?? "غير محدد"}</td>
                  <td>{money(Number(row.amount))}</td>
                  <td>
                    {row.appointmentAt
                      ? formatBaghdadDateTime(row.appointmentAt)
                      : "بانتظار تحديد الموعد"}
                  </td>
                  <td>
                    <RequestStatusBadge status={row.status} />
                  </td>
                  <td>{formatBaghdadDateTime(row.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn danger"
                      disabled={busyId !== null}
                      onClick={() => void remove(row)}
                    >
                      {busyId === row.id ? "جارٍ الحذف..." : "حذف"}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && !rows.length && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 30 }}>
                    لا توجد طلبات
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 30 }}>
                    جارٍ التحميل...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
