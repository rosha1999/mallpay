import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { formatBaghdadDate } from "@/lib/dates";
import RequestStatusBadge from "@/components/RequestStatusBadge";
export const dynamic = "force-dynamic";
const money = (n: number) =>
  new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 2 }).format(n) +
  " د.ع";
const latestFor = (where: Prisma.PaymentRequestWhereInput) =>
  prisma.paymentRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { company: true, mall: true },
  });
type RequestRow = Awaited<ReturnType<typeof latestFor>>[number];
type RequestGroup = {
  key: string;
  title: string;
  rows: RequestRow[];
  showMall: boolean;
};
export default async function Dashboard() {
  const [requests, companies, malls, payments, pending, mallList] =
    await Promise.all([
      prisma.paymentRequest.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.company.count(),
      prisma.mall.count(),
      prisma.payment.aggregate({ _sum: { amount: true } }),
      prisma.paymentRequest.count({ where: { status: "PENDING" } }),
      prisma.mall.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
  let groups: RequestGroup[];
  if (mallList.length) {
    const [perMall, unassigned] = await Promise.all([
      Promise.all(mallList.map((m) => latestFor({ mallId: m.id }))),
      latestFor({ mallId: null }),
    ]);
    groups = mallList.map((m, i) => ({
      key: m.id,
      title: `طلبات ${m.name}`,
      rows: perMall[i],
      showMall: false,
    }));
    if (unassigned.length) {
      groups.push({
        key: "unassigned",
        title: "طلبات بدون مول محدد",
        rows: unassigned,
        showMall: false,
      });
    }
  } else {
    groups = [
      {
        key: "all",
        title: "أحدث طلبات التسديد",
        rows: await latestFor({}),
        showMall: true,
      },
    ];
  }
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
        <div className="mallgrid">
          {groups.map((g) => (
            <section className="panel" key={g.key}>
              <div className="panelhead">
                <h2>{g.title}</h2>
                <a className="btn secondary" href="/dashboard/requests">
                  عرض الكل
                </a>
              </div>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>الشركة</th>
                      {g.showMall && <th>المول</th>}
                      <th>المبلغ</th>
                      <th>الموعد</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr
                        key={r.id}
                        className={`status-${r.status.toLowerCase()}`}
                      >
                        <td>
                          {r.companyName ?? r.company?.name ?? "غير محدد"}
                        </td>
                        {g.showMall && (
                          <td>{r.mall?.name ?? "غير محدد"}</td>
                        )}
                        <td>{money(Number(r.amount))}</td>
                        <td>
                          {r.appointmentAt
                            ? formatBaghdadDate(r.appointmentAt)
                            : "بانتظار تحديد الموعد"}
                        </td>
                        <td>
                          <RequestStatusBadge status={r.status} />
                        </td>
                      </tr>
                    ))}
                    {!g.rows.length && (
                      <tr>
                        <td
                          colSpan={g.showMall ? 5 : 4}
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
          ))}
        </div>
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
