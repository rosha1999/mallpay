import { prisma } from "@/lib/prisma";
import { formatBaghdadDate } from "@/lib/dates";
export const dynamic = "force-dynamic";
const money = (n: number) =>
  new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 2 }).format(n) +
  " د.ع";
export default async function Dashboard() {
  const [requests, companies, malls, payments, pending, latest] =
    await Promise.all([
      prisma.paymentRequest.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.company.count(),
      prisma.mall.count(),
      prisma.payment.aggregate({ _sum: { amount: true } }),
      prisma.paymentRequest.count({ where: { status: "PENDING" } }),
      prisma.paymentRequest.findMany({
        take: 7,
        orderBy: { createdAt: "desc" },
        include: { company: true, mall: true },
      }),
    ]);
  const paid = Number(payments._sum.amount || 0),
    requested = Number(requests._sum.amount || 0);
  return (
    <>
      <section className="cards">
        <div className="card">
          <span className="metric-icon">▣</span>
          <div className="metric-label">إجمالي الطلبات</div>
          <div className="metric">{requests._count._all}</div>
        </div>
        <div className="card">
          <span
            className="metric-icon"
            style={{ background: "#e1f8ed", color: "#159768" }}
          >
            ▦
          </span>
          <div className="metric-label">مواعيد قيد الانتظار</div>
          <div className="metric">{pending}</div>
        </div>
        <div className="card">
          <span
            className="metric-icon"
            style={{ background: "#fff0d9", color: "#bd7808" }}
          >
            ▤
          </span>
          <div className="metric-label">إجمالي المبالغ المطلوبة</div>
          <div className="metric" style={{ fontSize: 19 }}>
            {money(requested)}
          </div>
        </div>
        <div className="card">
          <span
            className="metric-icon"
            style={{ background: "#eee8ff", color: "#7650cf" }}
          >
            ✓
          </span>
          <div className="metric-label">إجمالي المبالغ المستلمة</div>
          <div className="metric" style={{ fontSize: 19 }}>
            {money(paid)}
          </div>
        </div>
      </section>
      <div className="layout2">
        <section className="panel">
          <div className="panelhead">
            <h2>أحدث طلبات التسديد</h2>
            <a className="btn secondary" href="/dashboard/requests">
              عرض الكل
            </a>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>الشركة</th>
                  <th>المول</th>
                  <th>المبلغ</th>
                  <th>الموعد</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((r) => (
                  <tr key={r.id}>
                    <td>{r.companyName ?? r.company?.name ?? "غير محدد"}</td>
                    <td>{r.mall?.name ?? "غير محدد"}</td>
                    <td>{money(Number(r.amount))}</td>
                    <td>
                      {r.appointmentAt
                        ? formatBaghdadDate(r.appointmentAt)
                        : "بانتظار تحديد الموعد"}
                    </td>
                    <td>
                      <span
                        className={`badge ${r.status === "PAID" ? "green" : r.status === "REJECTED" ? "red" : "orange"}`}
                      >
                        {
                          (
                            {
                              PENDING: "جديد",
                              APPROVED: "تمت الموافقة",
                              RESCHEDULED: "أعيدت الجدولة",
                              REJECTED: "مرفوض",
                              PAID: "مدفوع",
                              CANCELLED: "ملغى",
                            } as Record<string, string>
                          )[r.status]
                        }
                      </span>
                    </td>
                  </tr>
                ))}
                {!latest.length && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ textAlign: "center", padding: 30 }}
                    >
                      لا توجد طلبات حتى الآن
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panelhead">
            <h2>إجراءات سريعة</h2>
          </div>
          <div className="quick">
            <a href="/dashboard/requests">
              <span>📝</span>
              <div>
                <b>طلبات التسديد</b>
                <span className="muted">مراجعة وتحديث الطلبات</span>
              </div>
            </a>
            <a href="/dashboard/companies">
              <span>🏢</span>
              <div>
                <b>الشركات</b>
                <span className="muted">ملفات الشركات وسجلها المالي</span>
              </div>
            </a>
            <a href="/dashboard/malls">
              <span>🏬</span>
              <div>
                <b>المولات</b>
                <span className="muted">إدارة المولات</span>
              </div>
            </a>
            <a href="/dashboard/reports">
              <span>📊</span>
              <div>
                <b>التقارير</b>
                <span className="muted">تصفية وتصدير CSV</span>
              </div>
            </a>
          </div>
          <div
            className="cards"
            style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}
          >
            <div>
              <div className="metric-label">الشركات</div>
              <div className="metric">{companies}</div>
            </div>
            <div>
              <div className="metric-label">المولات</div>
              <div className="metric">{malls}</div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
