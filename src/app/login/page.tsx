"use client";
import { useState } from "react";
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "تعذر تسجيل الدخول");
      location.href = "/dashboard";
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="loginwrap">
      <form className="login" onSubmit={submit}>
        <div className="brand" style={{ color: "#102744", padding: 0 }}>
          ▥ Mall<span>Pay</span>
        </div>
        <p className="muted">تسجيل الدخول إلى لوحة الإدارة</p>
        <div className="field" style={{ marginTop: 22 }}>
          <label htmlFor="login-email">البريد الإلكتروني</label>
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="login-password">كلمة المرور</label>
          <input
            id="login-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn"
          style={{ width: "100%", marginTop: 20 }}
          disabled={busy}
        >
          {busy ? "جارٍ الدخول..." : "تسجيل الدخول"}
        </button>
      </form>
    </main>
  );
}
