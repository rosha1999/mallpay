import { describe, expect, it } from "vitest";
import { futureAppointmentAtSchema } from "./appointments";

describe("appointment API dates", () => {
  it("accepts future dates and rejects past appointments", () => {
    expect(
      futureAppointmentAtSchema.safeParse(
        new Date(Date.now() + 60_000).toISOString(),
      ).success,
    ).toBe(true);
    expect(
      futureAppointmentAtSchema.safeParse(
        new Date(Date.now() - 60_000).toISOString(),
      ).success,
    ).toBe(false);
  });
});
