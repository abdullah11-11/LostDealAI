/** Client convenience only. The API still validates its strict body and identity. */
export function normalizeProfileName(value: string): string | null {
  const name = value.trim();
  return name.length >= 1 && name.length <= 100 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}
