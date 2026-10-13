/** Cloudflare Worker entry point for LostDeal AI. */
import handler from "vinext/server/app-router-entry";
import { readBoundedRequest, RequestBodyLimitError } from "../lib/security/request-body";
import { reportFailure } from "../lib/security/diagnostics";
import { applySecurityHeaders } from "../lib/security/headers";

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  DB: unknown;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = crypto.randomUUID();
    const pathname = new URL(request.url).pathname;
    const headers = new Headers(request.headers);
    headers.set("x-lostdeal-request-id", requestId);
    let response: Response;
    try {
      const write = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      const multipart = headers.get("content-type")?.startsWith("multipart/form-data");
      const limit = multipart ? 6 * 1024 * 1024 : pathname.startsWith("/api/") ? 64 * 1024 : 16 * 1024;
      const body = write ? await readBoundedRequest(request, limit) : undefined;
      response = await handler.fetch(new Request(request, { headers, ...(write ? { body } : {}) }), env, ctx);
    } catch (error) {
      const status = error instanceof RequestBodyLimitError ? 413 : 500;
      reportFailure(requestId, pathname, status === 413 ? "request_too_large" : "unhandled_failure", status);
      response = Response.json({ error: status === 413 ? "The request is too large." : "This request could not be completed. Please try again.", requestId }, { status });
    }
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("x-request-id", requestId);
    if (response.status >= 500) reportFailure(requestId, pathname, "server_failure", response.status);
    if (pathname.startsWith("/api/")) responseHeaders.set("Cache-Control", "private, no-store");
    return applySecurityHeaders(new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders }), pathname, new URL(request.url).protocol);
  },
};

export default worker;
