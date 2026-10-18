"use client";

import { useEffect, useRef, useState } from "react";
import {
  dateTimeInputFromIso,
  dateTimeToIsoInBaghdad,
  formatBaghdadDateTime,
  todayInBaghdad,
} from "@/lib/dates";
import { fromCents, remainingBalanceCents, toCents } from "@/lib/money";
import { shouldRotatePaymentKey } from "@/lib/payment-retry";

type Row = {
  id: string;
  reference: string;
  amount: string;
  dueAt: string | null;
  appointmentAt: string | null;
  note: string | null;
  status: string;
  companyName: string | null;
  company: { name: string } | null;
  mall: { name: string } | null;
  payments: { amount: string }[];
};
type RequestPage = { rows: Row[]; total: number; page: number; pageCount: number };

const statuses = [
  ["PENDING", "طلب جديد"],
  ["APPROVED", "تم تحديد الموعد"],
  ["RESCHEDULED", "أعيدت الجدولة"],
  ["REJECTED", "مرفوض"],
  ["PAID", "مدفوع"],
  ["CANCELLED", "ملغى"],
] as const;
const statusLabel = Object.fromEntries(statuses) as Record<string, string>;

function useModalFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const modal = ref.current;
    if (!open || !modal) return;

    const previous = document.activeElement;
    const focusable = () =>
      Array.from(
        modal.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    (focusable()[0] ?? modal).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        modal!.focus();
        return;
      }
      if (
        !modal?.contains(document.activeElement) ||
        document.activeElement === modal
      ) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0]).focus();
      } else if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === items[items.length - 1]
      ) {
        event.preventDefault();
        items[0].focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [open]);

  return ref;
}

async function fetchRequests(status: string, page: number): Promise<RequestPage> {
  const params = new URLSearchParams({ page: String(page) });
  if (status !== "ALL") params.set("status", status);
  const response = await fetch(`/api/requests?${params}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "تعذر تحميل الطلبات");
  return data as RequestPage;
}

export default function Requests() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [payRow, setPayRow] = useState<Row | null>(null);
  const [paymentRequestId, setPaymentRequestId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("CASH");
  const [payNotes, setPayNotes] = useState("");
  const [paymentKey, setPaymentKey] = useState("");
  const paymentKeyRef = useRef("");
  const [retryLocked, setRetryLocked] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const remainingCents = payRow
    ? (remainingBalanceCents(
        payRow.amount,
        payRow.payments.map((payment) => payment.amount),
      ) ?? 0n)
    : 0n;
  const remaining = fromCents(remainingCents);
  const payAmountCents = toCents(payAmount);
  const paymentModalRef = useModalFocus(Boolean(payRow), () => setPayRow(null));
  const scheduleModalRef = useModalFocus(Boolean(selected), () =>
    setSelected(null),
  );

  function persistPaymentDraft(
    requestId: string,
    key: string,
    amount: string,
    method: string,
    notes: string,
    attempted = false,
  ) {
    try {
      sessionStorage.setItem(
        `mallpay:payment:${requestId}`,
        JSON.stringify({ key, amount, method, notes, attempted }),
      );
    } catch {
      // Keep the in-memory intent if tab storage is unavailable.
    }
  }

  function clearPaymentDraft(requestId: string) {
    try {
      sessionStorage.removeItem(`mallpay:payment:${requestId}`);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetchRequests(statusFilter, page)
      .then((data) => {
        if (active) {
          setRows(data.rows);
          setTotalRows(data.total);
          setPageCount(data.pageCount);
          setPage(data.page);
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "تعذر تحميل الطلبات",
          );
        if (active) setRows([]);
        if (active) {
          setTotalRows(0);
          setPageCount(1);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [statusFilter, page]);

  const money = (value: string | number) =>
    `${new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 2 }).format(Number(value))} د.ع`;
  const paidAmount = (row: Row) =>
    row.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);

  function openSchedule(row: Row) {
    setSelected(row);
    const input = dateTimeInputFromIso(row.appointmentAt || row.dueAt);
    setDate(input.date);
    setTime(input.time || "10:00");
    setNote(row.note || "");
    setNotice("");
    setError("");
  }

  function openPayment(row: Row) {
    setPayRow(row);
    let saved: unknown;
    try {
      saved = JSON.parse(
        sessionStorage.getItem(`mallpay:payment:${row.id}`) || "null",
      );
    } catch {
      clearPaymentDraft(row.id);
    }
    if (
      saved &&
      typeof saved === "object" &&
      "key" in saved &&
      typeof saved.key === "string" &&
      "amount" in saved &&
      typeof saved.amount === "string" &&
      "method" in saved &&
      typeof saved.method === "string" &&
      "notes" in saved &&
      typeof saved.notes === "string"
    ) {
      paymentKeyRef.current = saved.key;
      setPaymentRequestId(row.id);
      setPaymentKey(saved.key);
      setPayAmount(saved.amount);
      setPayMethod(saved.method);
      setPayNotes(saved.notes);
      setRetryLocked("attempted" in saved && saved.attempted === true);
    } else if (paymentRequestId !== row.id || !paymentKeyRef.current) {
      const key = crypto.randomUUID();
      paymentKeyRef.current = key;
      setPaymentRequestId(row.id);
      setPayAmount("");
      setPayMethod("CASH");
      setPayNotes("");
      setPaymentKey(key);
      setRetryLocked(false);
      persistPaymentDraft(row.id, key, "", "CASH", "");
    }
    setError("");
  }

  async function refresh() {
    setLoading(true);
    try {
      const data = await fetchRequests(statusFilter, page);
      setRows(data.rows);
      setTotalRows(data.total);
      setPageCount(data.pageCount);
      setPage(data.page);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تحديث الطلبات");
      setRows([]);
      setTotalRows(0);
      setPageCount(1);
    } finally {
      setLoading(false);
    }
  }

  function changePage(nextPage: number) {
    setRows([]);
    setError("");
    setLoading(true);
    setPage(nextPage);
  }

  async function reject(row: Row) {
    const reason = window.prompt("سبب رفض الطلب؟");
    if (!reason || reason.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/requests/${row.id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر رفض الطلب");
      setNotice("تم رفض الطلب وتسجيل السبب.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر رفض الطلب");
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payRow || !paymentKey) return;
    if (
      payAmountCents === null ||
      payAmountCents <= 0n ||
      payAmountCents > remainingCents
    ) {
      setError("مبلغ الدفعة يتجاوز الرصيد المتبقي.");
      return;
    }
    setBusy(true);
    setRetryLocked(true);
    setError("");
    persistPaymentDraft(
      payRow.id,
      paymentKeyRef.current,
      payAmount,
      payMethod,
      payNotes,
      true,
    );
    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: payRow.id,
          idempotencyKey: paymentKey,
          amount: payAmount,
          method: payMethod,
          notes: payNotes || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (shouldRotatePaymentKey(response.status, data.code)) {
          const nextKey = crypto.randomUUID();
          paymentKeyRef.current = nextKey;
          setPaymentKey(nextKey);
          setRetryLocked(false);
          persistPaymentDraft(
            payRow.id,
            nextKey,
            payAmount,
            payMethod,
            payNotes,
          );
        }
        throw new Error(data.error || "تعذر تسجيل الدفعة");
      }
      setPayRow(null);
      clearPaymentDraft(payRow.id);
      setPaymentRequestId("");
      paymentKeyRef.current = "";
      setPaymentKey("");
      setPayAmount("");
      setPayNotes("");
      setNotice("تم تسجيل الدفعة. إعادة المحاولة بنفس المفتاح لن تكررها.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تسجيل الدفعة");
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule() {
    if (!selected || !date || !time) return;
    const appointmentAt = dateTimeToIsoInBaghdad(date, time);
    if (!appointmentAt || new Date(appointmentAt).getTime() <= Date.now()) {
      setError("اختر موعداً صحيحاً في المستقبل بتوقيت بغداد.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/requests/${selected.id}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentAt,
          note,
          status: selected.appointmentAt ? "RESCHEDULED" : "APPROVED",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر حفظ الموعد");
      setSelected(null);
      setNotice(data.message || "تم حفظ الموعد.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر حفظ الموعد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="title">طلبات التسديد</h2>
      <p className="muted">راجع المبلغ أولاً، ثم حدّد موعد الاستلام بنفسك.</p>
      <div className="requests-toolbar">
        <label htmlFor="request-status">تصفية الحالة</label>
        <select
          id="request-status"
          value={statusFilter}
          disabled={busy || loading}
          onChange={(event) => {
            setRows([]);
            setTotalRows(0);
            setPageCount(1);
            setError("");
            setLoading(true);
            setPage(1);
            setStatusFilter(event.target.value);
          }}
        >
          <option value="ALL">كل الطلبات</option>
          {statuses.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
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
                <th>رقم الطلب</th>
                <th>الشركة</th>
                <th>المول</th>
                <th>المطلوب</th>
                <th>المدفوع</th>
                <th>موعد الاستلام</th>
                <th>الحالة</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                rows.map((row) => {
                  const manageable = ![
                    "PAID",
                    "REJECTED",
                    "CANCELLED",
                  ].includes(row.status);
                  return (
                    <tr key={row.id}>
                      <td>{row.reference.slice(0, 8)}</td>
                      <td>{row.companyName ?? row.company?.name ?? "غير محدد"}</td>
                      <td>{row.mall?.name ?? "غير محدد"}</td>
                      <td>{money(row.amount)}</td>
                      <td>{money(paidAmount(row))}</td>
                      <td>
                        {row.appointmentAt
                          ? formatBaghdadDateTime(row.appointmentAt)
                          : "لم يحدد بعد"}
                      </td>
                      <td>
                        <span
                          className={`badge ${row.status === "PAID" ? "green" : row.status === "REJECTED" ? "red" : row.status === "PENDING" ? "orange" : "blue"}`}
                        >
                          {statusLabel[row.status] || row.status}
                        </span>
                      </td>
                      <td>
                        {manageable && (
                          <div className="tableactions">
                            <button
                              className="btn secondary"
                              disabled={busy || loading}
                              onClick={() => openSchedule(row)}
                            >
                              {row.appointmentAt
                                ? "تغيير الموعد"
                                : "تحديد موعد"}
                            </button>
                            <button
                              className="btn secondary"
                              disabled={busy || loading}
                              onClick={() => openPayment(row)}
                            >
                              تسجيل دفعة
                            </button>
                            {row.status === "PENDING" &&
                              row.payments.length > 0 && (
                                <span className="muted">
                                  لا يمكن الرفض بعد استلام دفعة
                                </span>
                              )}
                            {row.status === "PENDING" &&
                              row.payments.length === 0 && (
                              <button
                                className="btn secondary"
                                disabled={busy || loading}
                                onClick={() => void reject(row)}
                              >
                                رفض
                              </button>
                              )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {loading && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 30 }}>
                    جارٍ تحميل الطلبات…
                  </td>
                </tr>
              )}
              {!loading && !rows.length && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 30 }}>
                    لا توجد طلبات في هذه الحالة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <nav className="pagination" aria-label="صفحات الطلبات">
            <button
              className="btn secondary"
              type="button"
              disabled={loading || busy || page <= 1}
              onClick={() => changePage(page - 1)}
            >
              السابق
            </button>
            <span aria-current="page">
              صفحة {page} من {pageCount} · {totalRows} طلباً
            </span>
            <button
              className="btn secondary"
              type="button"
              disabled={loading || busy || page >= pageCount}
              onClick={() => changePage(page + 1)}
            >
              التالي
            </button>
          </nav>
        )}
      </section>

      {payRow && (
        <div className="modalback">
          <section
            ref={paymentModalRef}
            className="panel modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-title"
            tabIndex={-1}
          >
            <form onSubmit={(event) => void recordPayment(event)}>
              <h2 id="payment-title">تسجيل دفعة</h2>
              <p className="muted">
                {payRow.companyName ?? payRow.company?.name ?? "غير محدد"} · المطلوب {money(payRow.amount)} · المدفوع{" "}
                {money(paidAmount(payRow))} · المتبقي {money(remaining)}
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="formgrid">
                <div className="field">
                  <label htmlFor="payment-amount">مبلغ الدفعة (د.ع)</label>
                  <input
                    id="payment-amount"
                    type="number"
                    min="0.01"
                    max={remaining}
                    step="0.01"
                    value={payAmount}
                    disabled={retryLocked}
                    onChange={(event) => {
                      setPayAmount(event.target.value);
                      persistPaymentDraft(
                        payRow.id,
                        paymentKeyRef.current,
                        event.target.value,
                        payMethod,
                        payNotes,
                      );
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="payment-method">طريقة الدفع</label>
                  <select
                    id="payment-method"
                    value={payMethod}
                    disabled={retryLocked}
                    onChange={(event) => {
                      setPayMethod(event.target.value);
                      persistPaymentDraft(
                        payRow.id,
                        paymentKeyRef.current,
                        payAmount,
                        event.target.value,
                        payNotes,
                      );
                    }}
                  >
                    <option value="CASH">نقداً</option>
                    <option value="BANK_TRANSFER">تحويل مصرفي</option>
                    <option value="CARD">بطاقة</option>
                    <option value="OTHER">أخرى</option>
                  </select>
                </div>
                <div className="field" style={{ gridColumn: "1/-1" }}>
                  <label htmlFor="payment-notes">ملاحظات</label>
                  <textarea
                    id="payment-notes"
                    value={payNotes}
                    disabled={retryLocked}
                    onChange={(event) => {
                      setPayNotes(event.target.value);
                      persistPaymentDraft(
                        payRow.id,
                        paymentKeyRef.current,
                        payAmount,
                        payMethod,
                        event.target.value,
                      );
                    }}
                    rows={2}
                  />
                </div>
              </div>
              <div className="modalactions">
                <button
                  className="btn"
                  type="submit"
                  disabled={
                    busy ||
                    payAmountCents === null ||
                    payAmountCents <= 0n ||
                    payAmountCents > remainingCents
                  }
                >
                  {busy ? "جارٍ الحفظ…" : "حفظ الدفعة"}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setPayRow(null)}
                >
                  إلغاء
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {selected && (
        <div className="modalback">
          <section
            ref={scheduleModalRef}
            className="panel modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-title"
            tabIndex={-1}
          >
            <h2 id="schedule-title">تحديد موعد الاستلام</h2>
            <p className="muted">
              {selected.companyName ?? selected.company?.name ?? "غير محدد"} · {money(selected.amount)}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="formgrid">
              <div className="field">
                <label htmlFor="schedule-date">التاريخ</label>
                <input
                  id="schedule-date"
                  type="date"
                  min={todayInBaghdad()}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="schedule-time">الوقت</label>
                <input
                  id="schedule-time"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  required
                />
              </div>
              <div className="field" style={{ gridColumn: "1/-1" }}>
                <label htmlFor="schedule-note">ملاحظات اختيارية</label>
                <textarea
                  id="schedule-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  placeholder="ملاحظات الموعد"
                />
              </div>
            </div>
            <div className="modalactions">
              <button
                className="btn"
                type="button"
                disabled={busy || !date || !time}
                onClick={() => void saveSchedule()}
              >
                {busy ? "جارٍ الحفظ…" : "اعتماد الموعد"}
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                إلغاء
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
