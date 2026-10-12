"use client";
import { useCallback, useEffect, useState } from "react";
type Mall = {
  id: string;
  name: string;
  location: string | null;
  active: boolean;
};
type MallEdit = Pick<Mall, "id" | "name" | "location">;
export default function Malls() {
  const [rows, setRows] = useState<Mall[]>([]),
    [name, setName] = useState(""),
    [location, setLocation] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [editing, setEditing] = useState<MallEdit | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/malls?includeInactive=true");
    if (!r.ok) throw new Error("تعذر تحميل المولات");
    setRows(await r.json());
  }, []);
  useEffect(() => {
    load()
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "تعذر تحميل المولات",
        ),
      )
      .finally(() => setLoading(false));
  }, [load]);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("اسم المول يجب أن يحتوي على حرفين على الأقل.");
      return;
    }
    let saved = false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/malls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), location }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setName("");
      setLocation("");
      setNotice("تمت إضافة المول.");
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
        setError("تم حفظ المول، لكن تعذر تحديث القائمة. أعد تحميل الصفحة.");
      }
    }
  }
  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (editing.name.trim().length < 2) {
      setError("اسم المول يجب أن يحتوي على حرفين على الأقل.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { id, ...data } = editing;
      const response = await fetch(`/api/malls/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          name: data.name.trim(),
          location: data.location?.trim() || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تعذر تحديث المول");
      setEditing(null);
      setNotice("تم تحديث بيانات المول.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تحديث المول");
    } finally {
      setBusy(false);
    }
  }
  async function toggleMall(mall: Mall) {
    const active = !mall.active;
    if (
      !window.confirm(
        active
          ? `تفعيل ${mall.name}؟ ستحتاج الشركات المرتبطة إلى إصدار روابط جديدة إذا سبق إيقافها.`
          : `إيقاف ${mall.name}؟ سيمنع الطلبات الجديدة ويبطل روابط الشركات، من دون حذف السجلات والدفعات السابقة.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/malls/${mall.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تعذر تغيير حالة المول");
      setNotice(active ? "تم تفعيل المول." : "تم إيقاف المول وإبطال روابط شركاته.");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "تعذر تغيير حالة المول",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2 className="title">إدارة المولات</h2>
      <p className="muted">إضافة المولات وعرض بياناتها</p>
      <form className="panel formgrid" onSubmit={add}>
        <div className="field">
          <label htmlFor="mall-name">اسم المول *</label>
          <input
            id="mall-name"
            required
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: مول أربيل"
          />
        </div>
        <div className="field">
          <label htmlFor="mall-location">الموقع</label>
          <input
            id="mall-location"
            maxLength={200}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="المدينة أو العنوان"
          />
        </div>
        <div>
          <button className="btn" disabled={busy}>
            {busy ? "جارٍ الحفظ..." : "＋ إضافة مول"}
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
        </div>
      </form>
      {editing && (
        <form className="panel formgrid" onSubmit={saveEdit}>
          <h3 style={{ gridColumn: "1/-1" }}>تعديل مول {editing.name}</h3>
          <div className="field">
            <label htmlFor="edit-mall-name">اسم المول *</label>
            <input
              id="edit-mall-name"
              required
              minLength={2}
              maxLength={100}
              value={editing.name}
              onChange={(event) =>
                setEditing({ ...editing, name: event.target.value })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="edit-mall-location">الموقع</label>
            <input
              id="edit-mall-location"
              maxLength={200}
              value={editing.location || ""}
              onChange={(event) =>
                setEditing({ ...editing, location: event.target.value })
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
                <th>اسم المول</th>
                <th>الموقع</th>
                <th>الحالة</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.location || "—"}</td>
                  <td>
                    <span className={`badge ${m.active ? "green" : "red"}`}>
                      {m.active ? "نشط" : "متوقف"}
                    </span>
                  </td>
                  <td>
                    <div className="tableactions">
                      <button
                        className="btn secondary"
                        disabled={busy}
                        onClick={() =>
                          setEditing({
                            id: m.id,
                            name: m.name,
                            location: m.location,
                          })
                        }
                      >
                        تعديل
                      </button>
                      <button
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => void toggleMall(m)}
                      >
                        {m.active ? "إيقاف" : "تفعيل"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center" }}>
                    جارٍ التحميل…
                  </td>
                </tr>
              )}
              {!loading && !rows.length && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center" }}>
                    لا توجد مولات مسجلة
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
