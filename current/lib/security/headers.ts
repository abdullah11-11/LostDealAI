export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

export const BASE_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

export function isSensitivePath(pathname: string): boolean {
  return pathname === "/recovery"
    || pathname.startsWith("/recovery/")
    || pathname === "/insights"
    || pathname.startsWith("/insights/")
    || pathname === "/settings"
    || pathname.startsWith("/settings/")
    || pathname === "/dashboard"
    || pathname.startsWith("/dashboard/")
    || pathname === "/deals"
    || pathname.startsWith("/deals/")
    || pathname === "/upload"
    || pathname.startsWith("/upload/")
    || pathname === "/account"
    || pathname.startsWith("/account/")
    || pathname === "/login"
    || pathname === "/signup"
    || pathname === "/forgot-password"
    || pathname === "/reset-password"
    || pathname.startsWith("/auth/")
    || pathname === "/onboarding"
    || pathname.startsWith("/api/");
}

export function applySecurityHeaders<T extends Response>(
  response: T,
  pathname: string,
  protocol: string,
  paddleEnvironment: string | undefined = process.env.PADDLE_ENVIRONMENT,
): T {
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  if (pathname === "/account") {
    const live = paddleEnvironment === "live";
    const buy = live ? "https://buy.paddle.com" : "https://sandbox-buy.paddle.com";
    const api = live ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
    const cdn = live ? "https://cdn.paddle.com" : "https://sandbox-cdn.paddle.com";
    response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY
      .replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' https://cdn.paddle.com")
      .replace("connect-src 'self' https://*.supabase.co", `connect-src 'self' https://*.supabase.co ${buy} ${api}`)
      .replace("style-src 'self' 'unsafe-inline'", `style-src 'self' 'unsafe-inline' ${cdn}`)
      + `; frame-src ${buy} ${cdn}`);
    response.headers.set("Cache-Control", "private, no-store");
  }
  if (protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  if (isSensitivePath(pathname)) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Pragma", "no-cache");
  }
  return response;
}
