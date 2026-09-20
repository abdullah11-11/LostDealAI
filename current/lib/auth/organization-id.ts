import "server-only";

const WORKSPACE_NAMESPACE = "46a0f9dc-a07b-4f4a-9952-3d58ef8392d8";

function uuidBytes(uuid: string): Uint8Array {
  const compact = uuid.replaceAll("-", "");
  return Uint8Array.from(compact.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

/** Creates a deterministic UUIDv5 so retries cannot create a second V1 workspace. */
export async function primaryOrganizationIdForUser(userId: string): Promise<string> {
  const namespace = uuidBytes(WORKSPACE_NAMESPACE);
  const name = new TextEncoder().encode(userId);
  const input = new Uint8Array(namespace.length + name.length);
  input.set(namespace);
  input.set(name, namespace.length);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
