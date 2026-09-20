const NUMERIC_CLAIM_PATTERN = /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?|\b(?:USD|EUR|GBP)\s?\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?\s?%|\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}[/-](?:\d{2}|\d{4})\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+(?:19|20)\d{2})?\b)/gi;

function canonicalNumericClaim(value: string): string {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("en-US").trim();
  const compact = normalized.replace(/\s+/g, "").replace(/,/g, "");
  const currency = compact.match(/^(\$|€|£|usd|eur|gbp)(\d+(?:\.\d+)?)$/);
  if (currency) {
    const unit = currency[1] === "$" ? "usd" : currency[1] === "€" ? "eur" : currency[1] === "£" ? "gbp" : currency[1];
    return `currency:${unit}:${Number(currency[2])}`;
  }
  const percentage = compact.match(/^(\d+(?:\.\d+)?)%$/);
  if (percentage) return `percent:${Number(percentage[1])}`;

  const isoDate = compact.match(/^((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (isoDate) return `date:${isoDate[1]}-${isoDate[2].padStart(2, "0")}-${isoDate[3].padStart(2, "0")}`;
  const numericDate = compact.match(/^(\d{1,2})[/-](\d{1,2})[/-]((?:19|20)?\d{2})$/);
  if (numericDate) {
    const year = numericDate[3].length === 2 ? `20${numericDate[3]}` : numericDate[3];
    return `date:${year}-${numericDate[1].padStart(2, "0")}-${numericDate[2].padStart(2, "0")}`;
  }
  const monthNames: Record<string, string> = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", september: "09", oct: "10", october: "10",
    nov: "11", november: "11", dec: "12", december: "12",
  };
  const writtenDate = normalized.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+((?:19|20)\d{2}))?$/);
  if (writtenDate && monthNames[writtenDate[1]]) {
    return `date:${writtenDate[3] ?? "unknown"}-${monthNames[writtenDate[1]]}-${writtenDate[2].padStart(2, "0")}`;
  }
  return compact;
}

export function extractNumericClaims(value: string): string[] {
  return (value.match(NUMERIC_CLAIM_PATTERN) ?? []).map(canonicalNumericClaim);
}

export function unsupportedNumericClaims(claimText: string, trustedSourceText: string): string[] {
  const supported = new Set(extractNumericClaims(trustedSourceText));
  return Array.from(new Set(extractNumericClaims(claimText).filter((claim) => !supported.has(claim))));
}
