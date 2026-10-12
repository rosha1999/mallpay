"use client";
import { useEffect, useState } from "react";
type Mall = { id: string; name: string };
type Company = { id: string; name: string };
export default function Reports() {
  const [malls, setMalls] = useState<Mall[]>([]),
    [companies, setCompanies] = useState<Company[]>([]),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [mallId, setMallId] = useState(""),
    [companyId, setCompanyId] = useState(""),
    [status, setStatus] = useState(""),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/malls"), fetch("/api/companies")])
      .then(async ([mallResponse, companyResponse]) => {
        if (!mallResponse.ok || !companyResponse.ok)
          throw new Error("تعذر تحميل خيارات التقرير");
        const [mallData, companyData] = await Promise.all([
          mallResponse.json(),
          companyResponse.json(),
        ]);
        if (active) {
          setMalls(mallData);
          setCompanies(companyData);
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "تعذر تحميل خيارات التقرير",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function exportCsv() {
    if (from && to && from > to) {
      setError("يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساوياً له.");
      return;
    }
    setError("");
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (mallId) p.set("mallId", mallId);
    if (companyId) p.set("companyId", companyId);
    if (status) p.set("status", status);
    setExporting(true);
    try {
      const response = await fetch(`/api/reports/csv?${p.toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "تعذر تصدير التقرير");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "mallpay-report.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تصدير التقرير");
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <h2 className="title">التقارير</h2>
      <p className="muted">تصفية طلبات التسديد وتصدير البيانات بصيغة CSV</p>
      <section className="panel">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="formgrid">
          <div className="field">
            <label htmlFor="report-from">من تاريخ</label>
            <input
              id="report-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="report-to">إلى تاريخ</label>
            <input
              id="report-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="report-mall">المول</label>
            <select
              id="report-mall"
              value={mallId}
              onChange={(e) => setMallId(e.target.value)}
            >
              <option value="">كل المولات</option>
              {malls.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="report-company">الشركة</label>
            <select
              id="report-company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              <option value="">كل الشركات</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="report-status">الحالة</label>
            <select
              id="report-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">كل الحالات</option>
              {[
                ["PENDING", "جديد"],
                ["APPROVED", "تمت الموافقة"],
                ["RESCHEDULED", "أعيدت الجدولة"],
                ["REJECTED", "مرفوض"],
                ["PAID", "مدفوع"],
                ["CANCELLED", "ملغى"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          className="btn"
          style={{ marginTop: 18 }}
          disabled={loading || exporting}
          onClick={() => void exportCsv()}
        >
          {loading
            ? "جارٍ تحميل الخيارات…"
            : exporting
              ? "جارٍ التصدير…"
              : "↓ تصدير CSV"}
        </button>
      </section>
    </>
  );
}
