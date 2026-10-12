"use client";

import { useCallback, useEffect, useState } from "react";
import { formatBaghdadDate } from "@/lib/dates";

type TokenInfo = {
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};
type Company = {
  id: string;
  name: string;
  active: boolean;
  mall: { name: string; active: boolean };
  tokens: TokenInfo[];
};
type IssuedLink = {
  companyId: string;
  companyName: string;
  publicLink: string;
  expiresAt: string;
};

function activeToken(company: Company): TokenInfo | null {
  if (!company.active || !company.mall.active) return null;
  const token = company.tokens[0];
  if (!token || token.revokedAt) return null;
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now())
    return null;
  return token;
}

export default function CompanyLinks() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch("/api/companies");
    if (!response.ok) throw new Error("تعذر تحميل الشركات");
    setCompanies(await response.json());
  }, []);

  useEffect(() => {
    load()
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "تعذر تحميل البيانات",
        ),
      )
      .finally(() => setLoading(false));
  }, [load]);

  async function rotate(company: Company) {
    setBusyId(company.id);
    setError("");
    setNotice("");
    setIssued(null);
    let data: { publicLink: string; expiresAt: string };
    try {
      const response = await fetch(`/api/companies/${company.id}/token`, {
        method: "POST",
      });
      const body = (await response.json()) as {
        publicLink?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "تعذر إصدار الرابط");
      if (!body.publicLink || !body.expiresAt)
        throw new Error("استجابة إصدار الرابط غير صالحة");
      data = { publicLink: body.publicLink, expiresAt: body.expiresAt };
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر إصدار الرابط");
      setBusyId("");
      return;
    }
    setIssued({ companyId: company.id, companyName: company.name, ...data });
    setNotice("تم إصدار رابط جديد. الرابط السابق لم يعد يعمل.");
    try {
      await load();
    } catch {
      setError("تم إصدار الرابط، لكن تعذر تحديث القائمة. أعد تحميل الصفحة.");
    } finally {
      setBusyId("");
    }
  }

  async function revoke(company: Company) {
    if (
      !window.confirm(
        `إلغاء رابط ${company.name}؟ لن يتمكن ممثلو الشركة من إرسال طلبات عبره.`,
      )
    )
      return;
    setBusyId(company.id);
    setError("");
    setNotice("");
    let data: { revoked: number };
    try {
      const response = await fetch(`/api/companies/${company.id}/token`, {
        method: "DELETE",
      });
      const body = (await response.json()) as {
        revoked?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "تعذر إلغاء الرابط");
      data = { revoked: body.revoked ?? 0 };
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر إلغاء الرابط");
      setBusyId("");
      return;
    }
    setIssued((current) =>
      current?.companyId === company.id ? null : current,
    );
    setNotice(
      data.revoked ? "تم إلغاء رابط الشركة." : "لا يوجد رابط فعّال لإلغائه.",
    );
    try {
      await load();
    } catch {
      setError("تم إلغاء الرابط، لكن تعذر تحديث القائمة. أعد تحميل الصفحة.");
    } finally {
      setBusyId("");
    }
  }

  async function copyLink() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.publicLink);
      setNotice("تم نسخ الرابط. أرسله للمندوب واحفظه في مكان آمن.");
    } catch {
      setNotice(
        "انسخ الرابط الظاهر يدوياً؛ لا يمكن استعادته بعد إغلاق هذه الصفحة.",
      );
    }
  }

  return (
    <>
      <h2 className="title">روابط الشركات</h2>
      <p className="muted">
        إصدار رابط طلب صالح 90 يوماً أو إلغاؤه فوراً. الرابط الجديد يلغي القديم.
      </p>
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
      {issued && (
        <section className="panel">
          <div className="panelhead">
            <h2>رابط جديد لشركة {issued.companyName}</h2>
            <button className="btn secondary" onClick={() => setIssued(null)}>
              إخفاء الرابط
            </button>
          </div>
          <div className="field">
            <label htmlFor="company-link">
              احفظ هذا الرابط الآن؛ لا نخزن النص الأصلي
            </label>
            <input
              id="company-link"
              readOnly
              dir="ltr"
              value={issued.publicLink}
            />
          </div>
          <p className="muted">
            ينتهي في {formatBaghdadDate(issued.expiresAt)}
          </p>
          <button className="btn" onClick={copyLink}>
            نسخ الرابط
          </button>
        </section>
      )}
      <section className="panel">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>الشركة</th>
                <th>المول</th>
                <th>حالة الرابط</th>
                <th>الصلاحية</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const token = activeToken(company);
                return (
                  <tr key={company.id}>
                    <td>{company.name}</td>
                    <td>{company.mall.name}</td>
                    <td>
                      <span className={`badge ${token ? "green" : "red"}`}>
                        {token
                          ? "فعّال"
                          : !company.active
                            ? "الشركة متوقفة"
                            : !company.mall.active
                              ? "المول متوقف"
                              : "غير فعّال"}
                      </span>
                    </td>
                    <td>
                      {token?.expiresAt
                        ? formatBaghdadDate(token.expiresAt)
                        : token
                          ? "بدون تاريخ انتهاء"
                          : "—"}
                    </td>
                    <td>
                      <div className="tableactions">
                        <button
                          className="btn secondary"
                          disabled={
                            !!busyId || !company.active || !company.mall.active
                          }
                          onClick={() => rotate(company)}
                        >
                          {busyId === company.id
                            ? "جارٍ الإصدار..."
                            : !company.active || !company.mall.active
                              ? "فعّل الشركة والمول"
                            : token
                              ? "تدوير الرابط"
                              : "إصدار رابط"}
                        </button>
                        {token && (
                          <button
                            className="btn secondary"
                            disabled={!!busyId}
                            onClick={() => revoke(company)}
                          >
                            إلغاء
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {loading && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 30 }}>
                    جارٍ التحميل…
                  </td>
                </tr>
              )}
              {!loading && !companies.length && !error && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 30 }}>
                    لا توجد شركات مسجلة
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
