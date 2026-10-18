"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { phoneNumberSchema } from "@/lib/phone";

type CompanyOption = { id: string; name: string; mall: string };
type Info = {
  company: { name: string; mall: string } | null;
  companies?: CompanyOption[];
};

export default function PublicCompanyPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  const submitLock = useRef(false);
  const storageKey = `mallpay:public-request:${token}`;

  const clearPendingStorage = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }, [storageKey]);

  useEffect(() => {
    let active = true;
    idempotencyKey.current = null;
    setCompanyId("");
    setRetryLocked(false);

    try {
      const pending = sessionStorage.getItem(storageKey);

      if (pending) {
        const saved = JSON.parse(pending) as {
          key?: unknown;
          representativeName?: unknown;
          phone?: unknown;
          amount?: unknown;
          companyId?: unknown;
        };

        if (
          typeof saved.key === "string" &&
          typeof saved.phone === "string" &&
          typeof saved.amount === "string"
        ) {
          idempotencyKey.current = saved.key;
          setPhone(saved.phone);
          setAmount(saved.amount);
          if (typeof saved.companyId === "string")
            setCompanyId(saved.companyId);
          setRetryLocked(true);
        }
      }
    } catch {
      clearPendingStorage();
    }

    fetch(`/api/public/${encodeURIComponent(token)}/requests`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (active) setInfo(d as Info);
      })
      .catch((e) => {
        if (active) setError(e.message || "الرابط غير صالح");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [clearPendingStorage, storageKey, token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (submitLock.current || !info) return;
    if (!info.company && !companyId) {
      setError("اختر الشركة التي تريد إرسال الطلب لها.");
      return;
    }

    const normalizedPhone = phoneNumberSchema.safeParse(phone);

    if (!normalizedPhone.success) {
      setError(
        "أدخل رقماً عراقياً يبدأ بـ07 أو رقماً دولياً مع رمز الدولة.",
      );
      return;
    }

    if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      setError("أدخل مبلغاً صحيحاً أكبر من صفر.");
      return;
    }

    submitLock.current = true;
    idempotencyKey.current ??= crypto.randomUUID();

    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          key: idempotencyKey.current,
          phone: normalizedPhone.data,
          amount,
          ...(info.company ? {} : { companyId }),
        }),
      );
    } catch {
      // Keep the in-memory key even when browser storage is unavailable.
    }

    setRetryLocked(true);
    setBusy(true);
    setError("");

    try {
      const r = await fetch(
        `/api/public/${encodeURIComponent(token)}/requests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: normalizedPhone.data,
            amount,
            ...(info.company ? {} : { companyId }),
            idempotencyKey: idempotencyKey.current,
          }),
        },
      );

      const d = await r.json();

      if (!r.ok) {
        if (
          r.status >= 400 &&
          r.status < 500 &&
          r.status !== 409 &&
          r.status !== 429
        ) {
          idempotencyKey.current = null;
          setRetryLocked(false);
          clearPendingStorage();
        }

        throw new Error(d.error || "تعذر إرسال الطلب");
      }

      idempotencyKey.current = null;
      setRetryLocked(false);
      clearPendingStorage();
      setReference(d.reference);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر الإرسال");
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="public-wrap">
      <section className="public-brand">
        <div className="brand">
          Mall<span>Pay</span>
        </div>
        <div className="public-mark">▥</div>
        <h1>نظام مواعيد التسديد للمولات</h1>
        <p>طلب موعد الاستلام — سريع، واضح وآمن</p>
      </section>

      <section className="public-card">
        <div className="public-head">
          <span className="public-icon">▦</span>
          <div>
            <h2>طلب موعد تسديد</h2>
            <p className="muted">
              أرسل بيانات الطلب، وستتم مراجعتها من الإدارة
            </p>
          </div>
        </div>

        {loading ? (
          <p>جارٍ تحميل بيانات الرابط…</p>
        ) : error && !info ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          info &&
          (reference ? (
            <div className="success-box" role="status" aria-live="polite">
              <div className="success-icon">✓</div>
              <h2>تم إرسال الطلب بنجاح</h2>
              <p>
                رقم الطلب: <b>{reference.slice(0, 10)}</b>
              </p>
              <p className="muted">
                ستقوم الإدارة بمراجعة المبلغ وتحديد الموعد، ثم يصلك إشعار عند
                اعتماده.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="public-form">
              {info.company ? (
                <>
                  <div className="field">
                    <label htmlFor="company-name">الشركة</label>
                    <input
                      id="company-name"
                      value={info.company.name}
                      readOnly
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="mall-name">المول</label>
                    <input id="mall-name" value={info.company.mall} readOnly />
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="company-id">الشركة *</label>
                    <select
                      id="company-id"
                      required
                      disabled={busy || retryLocked}
                      value={companyId}
                      onChange={(e) => setCompanyId(e.target.value)}
                    >
                      <option value="">اختر الشركة</option>
                      {retryLocked &&
                        companyId &&
                        !info.companies?.some(
                          (company) => company.id === companyId,
                        ) && (
                          <option value={companyId}>
                            الشركة المحددة للطلب السابق
                          </option>
                        )}
                      {info.companies?.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name} — {company.mall}
                        </option>
                      ))}
                    </select>
                  </div>
                  {companyId && (
                    <div className="field">
                      <label htmlFor="mall-name">المول</label>
                      <input
                        id="mall-name"
                        value={
                          info.companies?.find(
                            (company) => company.id === companyId,
                          )?.mall ?? ""
                        }
                        readOnly
                      />
                    </div>
                  )}
                  {!info.companies?.length && (
                    <p className="muted">
                      لا توجد شركات فعّالة لاختيارها حالياً.
                    </p>
                  )}
                </>
              )}

              <div className="field">
                <label htmlFor="representative-phone">
                  رقم هاتف المندوب *
                </label>
                <input
                  id="representative-phone"
                  type="tel"
                  required
                  minLength={7}
                  maxLength={40}
                  title="أدخل رقم هاتف يحتوي على أرقام فقط مع رمز الدولة عند الحاجة"
                  disabled={busy || retryLocked}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07XXXXXXXXX"
                  inputMode="tel"
                />
              </div>

              <div className="field">
                <label htmlFor="request-amount">المبلغ المطلوب (د.ع) *</label>
                <input
                  id="request-amount"
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  disabled={busy || retryLocked}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="أدخل المبلغ"
                />
              </div>

              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}

              <button
                className="btn"
                disabled={busy || (!info.company && !info.companies?.length)}
              >
                {busy
                  ? "جارٍ إرسال الطلب…"
                  : retryLocked
                    ? "إعادة المحاولة بنفس الطلب"
                    : "إرسال الطلب ←"}
              </button>

              <p className="muted center">
                الموعد لا يحدده المندوب؛ ستراجعه الإدارة وتتواصل معك بعد
                اعتماده.
              </p>
            </form>
          ))
        )}
      </section>

      <footer className="public-footer">
        MallPay · نظام إدارة مواعيد التسديد
      </footer>
    </main>
  );
}
