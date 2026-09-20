import { z } from "zod";

const DealIdSchema = z.string().uuid();

export const DealMutationSchema = z.object({
  deal_id: DealIdSchema,
}).strict();

export const EmptyMutationSchema = z.object({}).strict();

export const ScoreBatchMutationSchema = z.object({
  mode: z.enum(["unscored", "refresh"]),
  cursor: z.string().uuid().nullable().optional(),
}).strict();
