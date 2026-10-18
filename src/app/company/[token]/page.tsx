"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { phoneNumberSchema } from "@/lib/phone";

type MallOption = { id: string; name: string };
type Info = {
  company: { name: string; mall: string } | null;
  malls?: MallOption[];
};

export default function PublicCompanyPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [mallId, setMallId] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const [legacyMallRetry, setLegacyMallRetry] = useState(false);
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
    setCompanyName("");
    setMallId("");
    setRetryLocked(false);
    setLegacyMallRetry(false);

    try {
      const pending = sessionStorage.getItem(storageKey);

      if (pending) {
        const saved = JSON.parse(pending) as {
          key?: unknown;
          representativeName?: unknown;
          phone?: unknown;
          amount?: unknown;
          companyId?: unknown;
          companyName?: unknown;
          mallId?: unknown;
        };

        const savedCompanyName =
          typeof saved.companyName === "string" ? saved.companyName : undefined;
        const legacyCompanySelection =
          typeof saved.companyId === "string" && savedCompanyName === undefined;
        if (
          typeof saved.key === "string" &&
          typeof saved.phone === "string" &&
          typeof saved.amount === "string" &&
          !legacyCompanySelection
        ) {
          idempotencyKey.current = saved.key;
          setPhone(saved.phone);
          setAmount(saved.amount);
          if (savedCompanyName) setCompanyName(savedCompanyName);
          if (typeof saved.mallId === "string") setMallId(saved.mallId);
          else if (savedCompanyName) setLegacyMallRetry(true);
          setRetryLocked(true);
        } else {
          clearPendingStorage();
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
    if (!info.company && companyName.trim().length < 2) {
      setError("اكتب اسم الشركة التي تريد إرسال الطلب لها.");
      return;
    }
    if (!info.company && !mallId) {
      setError("اختار المول الذي تتبع له الشركة.");
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
          ...(info.company ? {} : { companyName: companyName.trim() }),
          ...(info.company ? {} : { mallId }),
        }),
      );
    } catch {
      // Keep the in-memory key even when browser storage is unavailable.
    }

    setRetryLocked(true);
    setLegacyMallRetry(false);
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
            ...(info.company ? {} : { companyName: companyName.trim() }),
            ...(info.company ? {} : { mallId }),
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
          setLegacyMallRetry(false);
          clearPendingStorage();
        }

        throw new Error(d.error || "تعذر إرسال الطلب");
      }

      idempotencyKey.current = null;
      setRetryLocked(false);
      setLegacyMallRetry(false);
      clearPendingStorage();
      setReference(d.reference);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر الإرسال");
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  const selectedMallName = info?.malls?.find((mall) => mall.id === mallId)?.name;

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
              <p>
                الشركة: <b>{info.company?.name ?? companyName.trim()}</b>
              </p>
              {(info.company?.mall || selectedMallName) && (
                <p>
                  المول: <b>{info.company?.mall ?? selectedMallName}</b>
                </p>
              )}
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
                    <label htmlFor="request-mall">المول *</label>
                    <select
                      id="request-mall"
                      required
                      disabled={busy || (retryLocked && !legacyMallRetry)}
                      value={mallId}
                      onChange={(e) => setMallId(e.target.value)}
                    >
                      <option value="">اختر المول</option>
                      {info.malls?.map((mall) => (
                        <option key={mall.id} value={mall.id}>
                          {mall.name}
                        </option>
                      ))}
                    </select>
                    {!info.malls?.length && (
                      <p className="muted">
                        لا توجد مولات فعّالة للاختيار حالياً.
                      </p>
                    )}
                  </div>
                  <div className="field">
                    <label htmlFor="company-name">اسم الشركة *</label>
                    <input
                      id="company-name"
                      required
                      minLength={2}
                      maxLength={120}
                      disabled={busy || retryLocked}
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="اكتب اسم الشركة"
                      autoComplete="organization"
                    />
                  </div>
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
                disabled={busy || (!info.company && !info.malls?.length)}
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
