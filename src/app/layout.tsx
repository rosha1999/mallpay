import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "MallPay | نظام مواعيد التسديد",
  description: "نظام إدارة مواعيد تسديد المولات والشركات",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
