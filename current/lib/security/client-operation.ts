type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const memory = new Map<string, string>();
async function sha(value: BufferSource): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)), b => b.toString(16).padStart(2, "0")).join("");
}

/** Only a request hash and a random operation ID are retained, never source data. */
export async function clientOperation(namespace: string, input: unknown, suppliedStorage?: StorageLike) {
  let material = input;
  if (input instanceof FormData) {
    material = await Promise.all([...input.entries()].filter(([key]) => key !== "operation_id").map(async ([key, value]) =>
      [key, value instanceof File ? { name: value.name, hash: await sha(await value.arrayBuffer()) } : value]));
  }
  const key = "lostdeal-operation-v1:" + namespace + ":" + await sha(new TextEncoder().encode(JSON.stringify(material)));
  let storage = suppliedStorage;
  try { storage ??= typeof window === "undefined" ? undefined : window.sessionStorage; } catch { /* Restricted browser storage. */ }
  let id = memory.get(key);
  try { id ??= storage?.getItem(key) ?? undefined; } catch { /* Use the in-tab fallback. */ }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) id = crypto.randomUUID();
  memory.set(key, id);
  try { storage?.setItem(key, id); } catch { /* No source contents are stored. */ }
  return {
    id,
    complete() { memory.delete(key); try { storage?.removeItem(key); } catch { /* Best effort. */ } },
  };
}
