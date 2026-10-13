export function safeRoute(pathname: string): string {
  return pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id").slice(0, 160);
}
export function reportFailure(requestId: string, route: string, category: string, status: number): void {
  console.error(JSON.stringify({
    event: "lostdeal_request_failure", timestamp: new Date().toISOString(),
    request_id: requestId, route: safeRoute(route), category, status,
  }));
}
