import { MAX_CSV_FILENAME_LENGTH } from "@/lib/csv/constants";

/** Produces a display/storage label only; uploaded names are never filesystem paths. */
export function normalizeUploadedFilename(name: string): string {
  const normalized = name
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[\\/]+/g, "_")
    .replace(/[<>:"|?*'`&]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, MAX_CSV_FILENAME_LENGTH)
    .trim();
  return normalized || "upload.csv";
}
