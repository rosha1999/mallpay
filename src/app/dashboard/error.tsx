"use client";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="panel" role="alert">
      <h2>تعذر تحميل بيانات الصفحة</h2>
      <p className="muted">تحقق من الاتصال بقاعدة البيانات ثم أعد المحاولة.</p>
      <button className="btn" onClick={() => reset()}>
        إعادة المحاولة
      </button>
    </section>
  );
}
