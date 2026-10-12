"use client";
import { useCallback, useEffect, useState } from "react";
import { phoneNumberSchema } from "@/lib/phone";
type Mall = { id: string; name: string; active: boolean };
type Company = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  mall: Mall;
};
type CompanyEdit = Pick<
  Company,
  "id" | "name" | "contactName" | "phone" | "email"
>;
export default function Companies() {
  const [rows, setRows] = useState<Company[]>([]),
    [malls, setMalls] = useState<Mall[]>([]),
    [name, setName] = useState(""),
    [mallId, setMallId] = useState(""),
    [phone, setPhone] = useState(""),
    [email, setEmail] = useState(""),
    [link, setLink] = useState(""),
    [editing, setEditing] = useState<CompanyEdit | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch("/api/companies"),
      fetch("/api/malls"),
    ]);
    if (!a.ok || !b.ok) throw new Error("تعذر تحميل بيانات الشركات والمولات");
    const [companies, m] = await Promise.all([a.json(), b.json()]);
    setRows(companies);
    setMalls(m);
    setMallId((current) => current || m[0]?.id || "");
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
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("اسم الشركة يجب أن يحتوي على حرفين على الأقل.");
      return;
    }
    if (phone.trim() && !phoneNumberSchema.safeParse(phone).success) {
      setError("أدخل رقم هاتف بصيغة عراقية أو دولية صحيحة.");
      return;
    }
    let saved = false;
    setBusy(true);
    setError("");
    setNotice("");
    setLink("");
    try {
      const r = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), mallId, phone, email }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setLink(d.publicLink);
      setNotice("تم إنشاء الشركة والرابط. انسخ الرابط واحفظه بأمان.");
      setName("");
      setPhone("");
      setEmail("");
      saved = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
    if (saved) {
      try {
        await load();
      } catch {
        setError("تم حفظ الشركة، لكن تعذر تحديث القائمة. أعد تحميل الصفحة.");
      }
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setNotice("تم نسخ رابط الشركة.");
    } catch {
      setNotice("تعذر النسخ التلقائي؛ انسخ الرابط الظاهر يدوياً.");
    }
  }
  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (editing.name.trim().length < 2) {
      setError("اسم الشركة يجب أن يحتوي على حرفين على الأقل.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { id, ...data } = editing;
      const response = await fetch(`/api/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          name: data.name.trim(),
          contactName: data.contactName?.trim() || null,
          phone: data.phone?.trim() || "",
          email: data.email?.trim() || "",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تعذر تحديث الشركة");
      setEditing(null);
      setNotice("تم تحديث بيانات الشركة.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تحديث الشركة");
    } finally {
      setBusy(false);
    }
  }
  async function toggleCompany(company: Company) {
    const active = !company.active;
    if (
      !window.confirm(
        active
          ? `إعادة تفعيل ${company.name}؟ لن يعود رابطها السابق صالحاً؛ أصدر رابطاً جديداً بعد ذلك.`
          : `إيقاف ${company.name}؟ سيُبطل رابط الطلب ويحفظ كل السجلات والدفعات السابقة.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تعذر تغيير حالة الشركة");
      setNotice(active ? "تم تفعيل الشركة؛ أصدر رابطاً جديداً." : "تم إيقاف الشركة وإبطال روابطها.");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "تعذر تغيير حالة الشركة",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2 className="title">الشركات</h2>
      <p className="muted">إنشاء ملفات الشركات وإصدار رابط طلب التسديد</p>
      <form className="panel formgrid" onSubmit={add}>
        <div className="field">
          <label htmlFor="company-name">اسم الشركة *</label>
          <input
            id="company-name"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="company-mall">المول *</label>
          <select
            id="company-mall"
            required
            value={mallId}
            onChange={(e) => setMallId(e.target.value)}
          >
            {malls.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="company-phone">رقم الهاتف</label>
          <input
            id="company-phone"
            type="tel"
            inputMode="tel"
            maxLength={40}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="company-email">البريد الإلكتروني</label>
          <input
            id="company-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <button className="btn" disabled={busy || !malls.length}>
            {busy ? "جارٍ الحفظ..." : "＋ إضافة شركة"}
          </button>
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
      {link && (
            <div className="field">
              <label htmlFor="new-company-link">الرابط السري للشركة</label>
              <input id="new-company-link" value={link} readOnly dir="ltr" />
              <button
                type="button"
                className="btn secondary"
                onClick={() => void copyLink()}
              >
                نسخ رابط الشركة
              </button>
            </div>
          )}
        </div>
      </form>
      {editing && (
        <form className="panel formgrid" onSubmit={saveEdit}>
          <h3 style={{ gridColumn: "1/-1" }}>تعديل شركة {editing.name}</h3>
          <div className="field">
            <label htmlFor="edit-company-name">اسم الشركة *</label>
            <input
              id="edit-company-name"
              required
              minLength={2}
              maxLength={120}
              value={editing.name}
              onChange={(event) =>
                setEditing({ ...editing, name: event.target.value })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="edit-company-contact">اسم جهة الاتصال</label>
            <input
              id="edit-company-contact"
              maxLength={120}
              value={editing.contactName || ""}
              onChange={(event) =>
                setEditing({ ...editing, contactName: event.target.value })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="edit-company-phone">رقم الهاتف</label>
            <input
              id="edit-company-phone"
              type="tel"
              inputMode="tel"
              value={editing.phone || ""}
              onChange={(event) =>
                setEditing({ ...editing, phone: event.target.value })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="edit-company-email">البريد الإلكتروني</label>
            <input
              id="edit-company-email"
              type="email"
              value={editing.email || ""}
              onChange={(event) =>
                setEditing({ ...editing, email: event.target.value })
              }
            />
          </div>
          <div className="tableactions">
            <button className="btn" disabled={busy}>
              {busy ? "جارٍ الحفظ..." : "حفظ التعديلات"}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
      <section className="panel">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>اسم الشركة</th>
                <th>المول</th>
                <th>الهاتف</th>
                <th>البريد</th>
                <th>الحالة</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.mall.name}</td>
                  <td>{c.phone || "—"}</td>
                  <td>{c.email || "—"}</td>
                  <td>
                    <span className={`badge ${c.active ? "green" : "red"}`}>
                      {c.active ? "نشطة" : "متوقفة"}
                    </span>
                  </td>
                  <td>
                    <div className="tableactions">
                      <button
                        className="btn secondary"
                        disabled={busy}
                        onClick={() =>
                          setEditing({
                            id: c.id,
                            name: c.name,
                            contactName: c.contactName,
                            phone: c.phone,
                            email: c.email,
                          })
                        }
                      >
                        تعديل
                      </button>
                      <button
                        className="btn secondary"
                        disabled={busy || (!c.active && !c.mall.active)}
                        onClick={() => void toggleCompany(c)}
                      >
                        {c.active ? "إيقاف" : "تفعيل"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center" }}>
                    جارٍ التحميل…
                  </td>
                </tr>
              )}
              {!loading && !rows.length && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center" }}>
                    لا توجد شركات
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
