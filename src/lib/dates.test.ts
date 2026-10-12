import { describe, expect, it } from "vitest";
import { dateTimeInputFromIso, dateTimeToIsoInBaghdad } from "./dates";

describe("Baghdad appointment dates", () => {
  it("converts local appointment input to UTC and back without shifting", () => {
    const iso = dateTimeToIsoInBaghdad("2026-01-15", "09:30");
    expect(iso).toBe("2026-01-15T06:30:00.000Z");
    expect(dateTimeInputFromIso(iso)).toEqual({
      date: "2026-01-15",
      time: "09:30",
    });
  });

  it("rejects malformed and impossible date/time values", () => {
    expect(dateTimeToIsoInBaghdad("2026-02-30", "09:30")).toBeNull();
    expect(dateTimeToIsoInBaghdad("2026-01-15", "24:00")).toBeNull();
    expect(dateTimeToIsoInBaghdad("2026/01/15", "09:30")).toBeNull();
  });

  it("returns blank date inputs for invalid stored values", () => {
    expect(dateTimeInputFromIso("not-a-date")).toEqual({ date: "", time: "" });
  });
});
