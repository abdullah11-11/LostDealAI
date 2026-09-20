export function normalizeEvidenceText(value: string | null): string {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function evidenceTextContainsExcerpt(
  sourceText: string | null,
  excerpt: string,
): boolean {
  const normalizedSource = normalizeEvidenceText(sourceText);
  const normalizedExcerpt = normalizeEvidenceText(excerpt);
  return Boolean(normalizedExcerpt && normalizedSource.includes(normalizedExcerpt));
}
