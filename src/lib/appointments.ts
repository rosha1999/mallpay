import { z } from "zod";

export const futureAppointmentAtSchema = z
  .string()
  .datetime()
  .refine((value) => new Date(value).getTime() > Date.now());
