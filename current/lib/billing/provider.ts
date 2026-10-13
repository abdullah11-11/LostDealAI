/** Database provider identity, never checkout/browser status. */
export function isPaddleProvider(value: unknown): value is "paddle_sandbox" | "paddle_live" {
  return value === "paddle_sandbox" || value === "paddle_live";
}
