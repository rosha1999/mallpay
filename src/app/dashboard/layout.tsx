import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await currentAdmin();
  if (!admin) redirect("/login");
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <header className="topbar">
          <div>
            <h1 className="title">لوحة تحكم MallPay</h1>
            <div className="muted">صباح الخير، {admin.name} 👋</div>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="btn secondary">تسجيل الخروج</button>
          </form>
        </header>
        {children}
      </main>
    </div>
  );
}
