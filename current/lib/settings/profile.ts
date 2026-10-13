import { z } from "zod";

export const ProfileUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(100).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Use a name without control characters."),
}).strict();
