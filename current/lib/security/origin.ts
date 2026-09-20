import { NextResponse } from "next/server";

import { MAX_CSV_FILE_BYTES } from "@/lib/csv/constants";

export const TRUSTED_PRODUCTION_ORIGIN = "https://lostdeal-ai.equal-dune-2306.chatgpt.site";
export const MAX_MULTIPART_REQUEST_BYTES = MAX_CSV_FILE_BYTES + 1024 * 1024;
export const MAX_QUERY_STRING_LENGTH = 4_096;

export type MutationContentType = "json" | "multipart" | "empty-json";

export type MutationRequestIssue = {
  status: 400 | 403 | 413 | 415;
  message: string;
};

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Browsers send Origin for these POSTs. A missing Origin is accepted only for
 * compatible same-site/server callers when Fetch Metadata does not contradict
 * it; an explicit cross-site signal is always rejected.
 */
export function validateSameOrigin(request: Request): MutationRequestIssue | null {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLocaleLowerCase("en-US") ?? null;
  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    return fetchSite === "cross-site"
      ? { status: 403, message: "This request is not allowed." }
      : null;
  }

  const suppliedOrigin = normalizedOrigin(originHeader);
  const requestOrigin = normalizedOrigin(request.url);
  if (
    !suppliedOrigin ||
    !requestOrigin ||
    (suppliedOrigin !== requestOrigin && suppliedOrigin !== TRUSTED_PRODUCTION_ORIGIN)
  ) {
    return { status: 403, message: "This request is not allowed." };
  }
  return null;
}

function validateContentType(request: Request, expected: MutationContentType): MutationRequestIssue | null {
  const contentType = request.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
  if (expected === "multipart") {
    return contentType.startsWith("multipart/form-data;")
      ? null
      : { status: 415, message: "Upload requests must use multipart form data." };
  }
  return contentType.startsWith("application/json")
    ? null
    : { status: 415, message: "This request must use JSON." };
}

function validateBodyLength(request: Request, expected: MutationContentType): MutationRequestIssue | null {
  if (expected !== "multipart") return null;
  const rawLength = request.headers.get("content-length");
  if (!rawLength) return null;
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length < 0) {
    return { status: 400, message: "The upload request size is invalid." };
  }
  return length > MAX_MULTIPART_REQUEST_BYTES
    ? { status: 413, message: "This upload request is too large." }
    : null;
}

export function validateMutationRequest(
  request: Request,
  expected: MutationContentType,
): MutationRequestIssue | null {
  return validateSameOrigin(request)
    ?? validateContentType(request, expected)
    ?? validateBodyLength(request, expected);
}

export function mutationIssueResponse(issue: MutationRequestIssue): NextResponse {
  return NextResponse.json(
    { error: issue.message },
    { status: issue.status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function hasOversizedQueryString(url: URL): boolean {
  return url.search.length > MAX_QUERY_STRING_LENGTH;
}
