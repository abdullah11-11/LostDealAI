import "server-only";
import { Paddle, Environment, LogLevel } from "@paddle/paddle-node-sdk";
import { validatePaddleConfig } from "@/lib/billing/paddle-policy";
export function paddleServer() {
  validatePaddleConfig(process.env);
  const key = process.env.PADDLE_API_KEY;
  if (!key || !/^pdl_sdbx_apikey_[a-z0-9]{26}_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{3}$/.test(key)) throw new Error("BILLING_CONFIGURATION_REQUIRED");
  return new Paddle(key, { environment: Environment.sandbox, logLevel: LogLevel.none });
}
// Never retry mutations. A timed-out operation stays locked until a verified
// event or explicit reconciliation determines its outcome.
export async function boundedPaddleCall<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("PADDLE_TIMEOUT")), 10000); })]); }
  finally { clearTimeout(timer); }
}
