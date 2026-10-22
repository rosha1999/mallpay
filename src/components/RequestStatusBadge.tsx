const statusStyles: Record<string, { label: string; className: string }> = {
  PENDING: { label: "جديد", className: "orange" },
  APPROVED: { label: "تم تحديد الموعد", className: "green" },
  RESCHEDULED: { label: "أعيدت الجدولة", className: "purple" },
  REJECTED: { label: "مرفوض", className: "red" },
  PAID: { label: "مدفوع", className: "blue" },
  CANCELLED: { label: "ملغى", className: "gray" },
};

export default function RequestStatusBadge({ status }: { status: string }) {
  const meta = statusStyles[status] ?? {
    label: status,
    className: "gray",
  };
  return <span className={`badge ${meta.className}`}>{meta.label}</span>;
}
