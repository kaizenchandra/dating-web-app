import { z } from "zod";
export const subscriptionSchema = z.object({
  id: z.string(),
  plan_id: z.string(),
  status: z.enum([
    "created",
    "authenticated",
    "active",
    "pending",
    "halted",
    "cancelled",
    "completed",
    "expired",
  ]),
  current_end: z.number().nullable(),
  paid_count: z.number().int().nonnegative(),
});
export const paymentSchema = z.object({
  id: z.string(),
  order_id: z.string().nullable(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.string(),
  captured: z.boolean(),
  amount_refunded: z.number().int().nonnegative(),
  created_at: z.number().int(),
});
export function capturedPass(
  raw: unknown,
  orderId: string,
  amount: number,
  currency: string,
) {
  const p = paymentSchema.parse(raw);
  if (p.order_id !== orderId || p.amount !== amount || p.currency !== currency)
    throw Error("Payment does not match the stored order");
  return {
    payment: p,
    paid: p.status === "captured" && p.captured && p.amount_refunded === 0,
  };
}
