"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  dateTimeInputFromIso,
  dateTimeToIsoInBaghdad,
  todayInBaghdad,
} from "@/lib/dates";

export default function CalendarAppointmentActions({
  requestId,
  scheduledAt,
  note: initialNote,
}: {
  requestId: string | null;
  scheduledAt: string;
  note: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState(initialNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function openEditor() {
    const input = dateTimeInputFromIso(scheduledAt);
    setDate(input.date);
    setTime(input.time || "10:00");
    setNote(initialNote ?? "");
    setError("");
    setEditing(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestId) return;
    const appointmentAt = dateTimeToIsoInBaghdad(date, time);
    if (!appointmentAt || new Date(appointmentAt).getTime() <= Date.now()) {
      setError("اختر موعداً صحيحاً في المستقبل بتوقيت بغداد.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/requests/${requestId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentAt, note, status: "RESCHEDULED" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تعذر تحديث الموعد");
      setEditing(false);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تحديث الموعد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        className="btn secondary"
        type="button"
        disabled={!requestId}
        title={requestId ? undefined : "هذا الموعد غير مرتبط بطلب"}
        onClick={openEditor}
      >
        تغيير الموعد
      </button>
      {!requestId && <span className="muted"> غير مرتبط بطلب</span>}
      {editing && (
        <form className="panel formgrid" onSubmit={save}>
          <div className="field">
            <label htmlFor={`calendar-date-${requestId}`}>التاريخ</label>
            <input
              id={`calendar-date-${requestId}`}
              type="date"
              min={todayInBaghdad()}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor={`calendar-time-${requestId}`}>الوقت</label>
            <input
              id={`calendar-time-${requestId}`}
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
            />
          </div>
          <div className="field" style={{ gridColumn: "1/-1" }}>
            <label htmlFor={`calendar-note-${requestId}`}>ملاحظات الموعد</label>
            <textarea
              id={`calendar-note-${requestId}`}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          </div>
          {error && (
            <p className="error" role="alert" style={{ gridColumn: "1/-1" }}>
              {error}
            </p>
          )}
          <div className="tableactions" style={{ gridColumn: "1/-1" }}>
            <button className="btn" disabled={busy}>
              {busy ? "جارٍ الحفظ..." : "حفظ الموعد"}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
