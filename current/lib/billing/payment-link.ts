import { validatePaddleClientToken } from "@/lib/billing/paddle-policy";

const transactionId = /^txn_[a-z0-9]{26}$/;
export const PAYMENT_LINK_UNAVAILABLE = "This payment link is unavailable. Open Plan & Billing to manage your payment method.";
export function getPaymentLinkTransaction(search: string): string | null {
  if (search.length > 4096) throw new Error(PAYMENT_LINK_UNAVAILABLE);
  const values = new URLSearchParams(search).getAll("_ptxn");
  if (!values.length) return null;
  if (values.length !== 1 || !transactionId.test(values[0])) throw new Error(PAYMENT_LINK_UNAVAILABLE);
  return values[0];
}
/** Every SDK initialization path is bound, including ordinary plan checkout. */
export function assertPaddleInitializationSearch(search: string, approvedPaymentSearch?: string): void {
  const id = getPaymentLinkTransaction(search);
  if ((id && approvedPaymentSearch !== search) || (approvedPaymentSearch !== undefined && (search !== approvedPaymentSearch || !id))) throw new Error(PAYMENT_LINK_UNAVAILABLE);
}
/** Initialize only after owner-authenticated server/provider/database proof.
 * Paddle.js handles its own _ptxn overlay; this never opens items, grants a plan
 * or calls a provider mutation. Real Live browser/provider acceptance is pending. */
export async function bootstrapPaymentLink(search: string, options: {
  fetch: typeof fetch; initialize: (token: string, environment: "live") => Promise<unknown>;
}) {
  const id = getPaymentLinkTransaction(search);
  if (!id) return false;
  const response = await options.fetch("/api/billing/payment-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactionId: id }) });
  if (!response.ok) throw new Error(PAYMENT_LINK_UNAVAILABLE);
  const data = await response.json();
  if (data?.environment !== "live" || data.transactionId !== id) throw new Error(PAYMENT_LINK_UNAVAILABLE);
  try { validatePaddleClientToken(data.clientToken, "live"); } catch { throw new Error(PAYMENT_LINK_UNAVAILABLE); }
  if (!await options.initialize(data.clientToken, "live")) throw new Error(PAYMENT_LINK_UNAVAILABLE);
  return true;
}
