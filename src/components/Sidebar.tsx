"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "⌂　الرئيسية" },
  { href: "/dashboard/requests", label: "▣　الطلبات الجديدة" },
  { href: "/dashboard/notifications", label: "▤　الإشعارات" },
  { href: "/dashboard/calendar", label: "▦　المواعيد" },
  { href: "/dashboard/companies", label: "▤　الشركات" },
  { href: "/dashboard/company-links", label: "↗　رابط الطلب" },
  { href: "/dashboard/malls", label: "▥　المولات" },
  { href: "/dashboard/reports", label: "▧　التقارير" },
];

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        className="hamb"
        aria-expanded={open}
        aria-controls="admin-navigation"
        aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
        onClick={() => setOpen(!open)}
      >
        ☰ القائمة
      </button>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          ▥ Mall<span>Pay</span>
        </div>
        <div className="muted" style={{ color: "#a9bed7", padding: "0 10px" }}>
          نظام مواعيد التسديد للمولات
        </div>
        <nav
          className="nav"
          id="admin-navigation"
          aria-label="القائمة الرئيسية"
        >
          {links.map((link) => {
            const active =
              link.href === "/dashboard"
                ? pathname === link.href
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                className={active ? "active" : ""}
                href={link.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidefoot">
          نظام MallPay
          <br />
          إدارة آمنة وموثوقة
        </div>
      </aside>
    </>
  );
}
