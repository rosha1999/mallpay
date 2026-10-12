import { prisma } from "@/lib/prisma";
import { formatBaghdadDateTime, startOfTodayInBaghdad } from "@/lib/dates";
import CalendarAppointmentActions from "@/components/CalendarAppointmentActions";
export const dynamic = "force-dynamic";
const pageSize = 50;
export default async function Calendar({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const where = {
    status: "SCHEDULED" as const,
    scheduledAt: { gte: startOfTodayInBaghdad() },
  };
  const total = await prisma.appointment.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = await prisma.appointment.findMany({
    where,
    include: { company: { include: { mall: true } } },
    orderBy: { scheduledAt: "asc" },
    skip: (currentPage - 1) * pageSize,
    take: pageSize,
  });
  return (
    <>
      <h2 className="title">المواعيد</h2>
      <p className="muted">المواعيد القادمة حسب التاريخ والوقت</p>
      <section className="panel">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>التاريخ والوقت</th>
                <th>الشركة</th>
                <th>المول</th>
                <th>الحالة</th>
                <th>ملاحظات</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{formatBaghdadDateTime(a.scheduledAt)}</td>
                  <td>{a.company.name}</td>
                  <td>{a.company.mall.name}</td>
                  <td>
                    <span className="badge blue">مجدول</span>
                  </td>
                  <td>{a.note || "—"}</td>
                  <td>
                    <CalendarAppointmentActions
                      requestId={a.requestId}
                      scheduledAt={a.scheduledAt.toISOString()}
                      note={a.note}
                    />
                  </td>
                </tr>
              ))}
              {!total && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 30 }}>
                    لا توجد مواعيد قادمة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <nav className="pagination" aria-label="صفحات المواعيد">
            {currentPage > 1 && (
              <a className="btn secondary" href={`?page=${currentPage - 1}`}>
                السابق
              </a>
            )}
            <span aria-current="page">
              صفحة {currentPage} من {pageCount} · {total} موعداً
            </span>
            {currentPage < pageCount && (
              <a className="btn secondary" href={`?page=${currentPage + 1}`}>
                التالي
              </a>
            )}
          </nav>
        )}
      </section>
    </>
  );
}
