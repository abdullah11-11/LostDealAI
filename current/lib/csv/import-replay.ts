/** Recheck completion after validation: another identical request may commit
 * while duplicate-ID validation is reading the database. */
export async function validateImportWithReplay<T extends object, V extends object>(
  readReplay: () => Promise<T | null>,
  validate: () => Promise<V>,
): Promise<{ replay: T; validation: null } | { replay: null; validation: V }> {
  const existing = await readReplay();
  if (existing) return { replay: existing, validation: null };
  const validation = await validate();
  const completed = await readReplay();
  return completed ? { replay: completed, validation: null } : { replay: null, validation };
}
