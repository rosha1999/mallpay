"use client";

import { useCallback, useEffect, useState } from "react";
import { formatBaghdadDate } from "@/lib/dates";
import QRCode from "qrcode";

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
type IssuedLink =
  | { scope: "all"; publicLink: string; expiresAt: string }
  | {
      scope: "company";
      companyId: string;
      companyName: string;
      publicLink: string;
      expiresAt: string;
    };

function isActiveToken(
  token: TokenInfo | null | undefined,
): token is TokenInfo {
  if (!token || token.revokedAt) return false;
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now())
    return false;
  return true;
}

function activeToken(company: Company): TokenInfo | null {
  if (!company.active || !company.mall.active) return null;
  const token = company.tokens[0];
  return isActiveToken(token) ? token : null;
}

export default function CompanyLinks() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [globalToken, setGlobalToken] = useState<TokenInfo | null>(null);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl("");
    if (!issued?.publicLink) return;

    QRCode.toDataURL(issued.publicLink, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: "H",
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError("تعذر إنشاء رمز QR. انسخ الرابط يدوياً.");
      });

    return () => {
      cancelled = true;
    };
  }, [issued?.publicLink]);

  const load = useCallback(async () => {
    const [companiesResponse, linkResponse] = await Promise.all([
      fetch("/api/companies"),
      fetch("/api/company-links"),
    ]);
    if (!companiesResponse.ok) throw new Error("تعذر تحميل الشركات");
    if (!linkResponse.ok) throw new Error("تعذر تحميل حالة الرابط العام");
    const [companyRows, linkData] = await Promise.all([
      companiesResponse.json(),
      linkResponse.json(),
    ]);
    setCompanies(companyRows);
    setGlobalToken(linkData.token ?? null);
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
    setIssued({
      scope: "company",
      companyId: company.id,
      companyName: company.name,
      ...data,
    });
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
      current?.scope === "company" && current.companyId === company.id
        ? null
        : current,
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

  async function rotateGlobal() {
    if (
      isActiveToken(globalToken) &&
      !window.confirm(
        "إصدار رابط عام جديد سيوقف الرابط الحالي لجميع الشركات. هل تريد المتابعة؟",
      )
    )
      return;
    setBusyId("global");
    setError("");
    setNotice("");
    setIssued(null);
    let data: { publicLink: string; expiresAt: string };
    try {
      const response = await fetch("/api/company-links", { method: "POST" });
      const body = (await response.json()) as {
        publicLink?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "تعذر إصدار الرابط العام");
      if (!body.publicLink || !body.expiresAt)
        throw new Error("استجابة إصدار الرابط غير صالحة");
      data = { publicLink: body.publicLink, expiresAt: body.expiresAt };
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر إصدار الرابط العام");
      setBusyId("");
      return;
    }
    setIssued({ scope: "all", ...data });
    setNotice("تم إصدار رابط واحد لجميع الشركات. احفظه وشاركه مع المندوبين.");
    try {
      await load();
    } catch {
      setError("تم إصدار الرابط، لكن تعذر تحديث الحالة. أعد تحميل الصفحة.");
    } finally {
      setBusyId("");
    }
  }

  async function revokeGlobal() {
    if (
      !window.confirm(
        "إلغاء الرابط العام سيمنع جميع الشركات من استخدامه. هل تريد المتابعة؟",
      )
    )
      return;
    setBusyId("global");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/company-links", { method: "DELETE" });
      const body = (await response.json()) as {
        revoked?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "تعذر إلغاء الرابط العام");
      setIssued((current) => (current?.scope === "all" ? null : current));
      setNotice(
        body.revoked
          ? "تم إلغاء الرابط العام لجميع الشركات."
          : "لا يوجد رابط عام فعّال لإلغائه.",
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر إلغاء الرابط العام");
    } finally {
      setBusyId("");
    }
  }

  async function copyLink() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.publicLink);
      setNotice(
        issued.scope === "all"
          ? "تم نسخ الرابط العام. أرسله لممثلي جميع الشركات."
          : "تم نسخ الرابط. أرسله للمندوب واحفظه في مكان آمن.",
      );
    } catch {
      setNotice(
        "انسخ الرابط الظاهر يدوياً؛ لا يمكن استعادته بعد إغلاق هذه الصفحة.",
      );
    }
  }

  const globalActive = isActiveToken(globalToken);
  const hasActiveCompanies = companies.some(
    (company) => company.active && company.mall.active,
  );
  const issuedLabel =
    issued?.scope === "all" ? "جميع الشركات" : issued?.companyName ?? "";
  const issuedTarget =
    issued?.scope === "all"
      ? "لجميع الشركات"
      : issued?.companyName
        ? `لشركة ${issued.companyName}`
        : "";
  const issuedAlt =
    issued?.scope === "all" ? "all companies" : issued?.companyName ?? "";

  return (
    <>
      <h2 className="title">رابط الطلب لجميع الشركات</h2>
      <p className="muted">
        رابط واحد تستخدمه جميع الشركات؛ يختار المندوب شركته عند إرسال الطلب.
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
      <section className="panel">
        <div className="panelhead">
          <h2>الرابط العام</h2>
          <span className={`badge ${globalActive ? "green" : "red"}`}>
            {globalActive ? "فعّال" : "لا يوجد رابط عام فعّال"}
          </span>
        </div>
        {globalActive && globalToken?.expiresAt && (
          <p className="muted">
            ينتهي في {formatBaghdadDate(globalToken.expiresAt)}
          </p>
        )}
        <div className="tableactions">
          <button
            className="btn"
            disabled={!!busyId || loading || !hasActiveCompanies}
            onClick={rotateGlobal}
          >
            {busyId === "global"
              ? "جارٍ إصدار الرابط..."
              : globalActive
                ? "تدوير الرابط العام"
                : "إصدار رابط لجميع الشركات"}
          </button>
          {globalActive && (
            <button
              className="btn secondary"
              disabled={!!busyId}
              onClick={revokeGlobal}
            >
              إلغاء الرابط العام
            </button>
          )}
        </div>
        <p className="muted">
          الرابط صالح 90 يوماً. إصداره من جديد يوقف الرابط العام السابق؛ احتفظ
          بالرابط الجديد عند ظهوره.
        </p>
      </section>
      {issued && (
        <>
          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              .qr-print-sheet, .qr-print-sheet * { visibility: visible !important; }
              .qr-print-sheet {
                display: block !important;
                position: absolute !important;
                inset: 0 !important;
                width: 100% !important;
                padding: 24px !important;
                text-align: center !important;
                color: #000 !important;
                background: #fff !important;
              }
              .qr-print-sheet img { width: 280px !important; height: 280px !important; }
              @page { size: A4; margin: 15mm; }
            }
          `}</style>
          <section className="qr-print-sheet" style={{ display: "none" }}>
            <h1>رابط طلب تسديد</h1>
            <h2>{issuedLabel}</h2>
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt={`QR Code - ${issuedAlt}`}
              />
            )}
            <p>امسح الرمز لفتح نموذج طلب التسديد</p>
            <p dir="ltr" style={{ overflowWrap: "anywhere" }}>
              {issued.publicLink}
            </p>
            <p>ينتهي في: {formatBaghdadDate(issued.expiresAt)}</p>
          </section>
          <section className="panel">
            <div className="panelhead">
              <h2>رابط جديد {issuedTarget}</h2>
              <button
                className="btn secondary"
                onClick={() => setIssued(null)}
              >
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
            {qrDataUrl && (
              <div style={{ margin: "20px 0", textAlign: "center" }}>
                <img
                  src={qrDataUrl}
                  alt={`QR Code - ${issuedAlt}`}
                  width={220}
                  height={220}
                  style={{ display: "block", margin: "0 auto 12px" }}
                />
                <p className="muted">امسح الرمز لفتح نموذج طلب التسديد</p>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => window.print()}
                >
                  طباعة الرابط ورمز QR
                </button>
              </div>
            )}
            <button className="btn" onClick={copyLink}>
              نسخ الرابط
            </button>
          </section>
        </>
      )}
      <section className="panel">
        <div className="panelhead">
          <div>
            <h2>روابط منفصلة لكل شركة</h2>
            <p className="muted">
              روابط اختيارية خاصة بالشركة، مستقلة عن الرابط العام أعلاه.
            </p>
          </div>
        </div>
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
