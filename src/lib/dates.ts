const businessTimeZone = "Asia/Baghdad";

type DateTimeParts = { date: string; time: string };

function zonedParts(value: Date, timeZone = businessTimeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

export function dateTimeInputFromIso(
  value: string | Date | null,
): DateTimeParts {
  if (!value) return { date: "", time: "" };
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: "", time: "" };
  const parts = zonedParts(date);
  return {
    date: `${parts.year.toString().padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
  };
}

export function dateTimeToIsoInBaghdad(
  date: string,
  time: string,
): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const [year, month, day] = dateMatch.slice(1).map(Number);
  const [hour, minute] = timeMatch.slice(1).map(Number);
  if (year < 2000 || month < 1 || month > 12 || hour > 23 || minute > 59)
    return null;

  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wallTime);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return null;

  let instant = wallTime;
  for (let attempt = 0; attempt < 3; attempt++) {
    const local = zonedParts(new Date(instant));
    const representedWallTime = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
    );
    instant += wallTime - representedWallTime;
  }

  const resolved = zonedParts(new Date(instant));
  if (
    resolved.year !== year ||
    resolved.month !== month ||
    resolved.day !== day ||
    resolved.hour !== hour ||
    resolved.minute !== minute
  )
    return null;
  return new Date(instant).toISOString();
}

export function todayInBaghdad(): string {
  return dateTimeInputFromIso(new Date()).date;
}

export function startOfTodayInBaghdad(): Date {
  return new Date(dateTimeToIsoInBaghdad(todayInBaghdad(), "00:00")!);
}

export function formatBaghdadDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("ar-IQ", {
    timeZone: businessTimeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatBaghdadDate(value: string | Date): string {
  return new Intl.DateTimeFormat("ar-IQ", {
    timeZone: businessTimeZone,
    dateStyle: "medium",
  }).format(new Date(value));
}
