const USD_WHOLE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const USD_CENTS_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDealCurrency(value: string | number | null): string {
  if (value === null) return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return Number.isInteger(numeric) ? USD_WHOLE_FORMATTER.format(numeric) : USD_CENTS_FORMATTER.format(numeric);
}

export function formatDealDate(value: string | null): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "—";
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return "—";
  return DATE_FORMATTER.format(date);
}

export function formatDealTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : TIMESTAMP_FORMATTER.format(date);
}

export function humanizeDealEnum(value: string | null): string {
  if (!value) return "—";
  return value
    .toLocaleLowerCase("en-US")
    .split("_")
    .map((part) => part ? `${part[0].toLocaleUpperCase("en-US")}${part.slice(1)}` : "")
    .join(" ");
}
