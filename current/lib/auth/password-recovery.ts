export const PASSWORD_RESET_GENERIC_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

export const PASSWORD_RECOVERY_COOKIE = "lostdeal-password-recovery";
export const PASSWORD_RECOVERY_COOKIE_VALUE = "verified";
export const PASSWORD_RECOVERY_MAX_AGE_SECONDS = 15 * 60;
export const DEFAULT_APP_ORIGIN = "https://lostdeal-ai.equal-dune-2306.chatgpt.site";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PasswordRecoveryFieldErrors = Partial<
  Record<"email" | "password" | "passwordConfirmation", string>
>;

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function validateRecoveryEmail(formData: FormData) {
  const email = formText(formData, "email").trim().toLowerCase();
  const fieldErrors: PasswordRecoveryFieldErrors = {};
  if (!email) fieldErrors.email = "Enter your business email.";
  else if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }
  return { email, fieldErrors };
}

export function validateNewPassword(formData: FormData) {
  const password = formText(formData, "password");
  const passwordConfirmation = formText(formData, "passwordConfirmation");
  const fieldErrors: PasswordRecoveryFieldErrors = {};

  if (!password) fieldErrors.password = "Enter a new password.";
  else if (password.length < 8) fieldErrors.password = "Use at least 8 characters.";
  else if (password.length > 128) fieldErrors.password = "Keep your password under 128 characters.";

  if (!passwordConfirmation) {
    fieldErrors.passwordConfirmation = "Confirm your new password.";
  } else if (password !== passwordConfirmation) {
    fieldErrors.passwordConfirmation = "Passwords do not match.";
  }

  return { password, passwordConfirmation, fieldErrors };
}

export async function passwordRecoveryRateKey(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `password-recovery:${hash}`;
}

export function parseAppOrigin(value: string | undefined): string {
  const configured = value?.trim() || DEFAULT_APP_ORIGIN;
  const parsed = new URL(configured);
  const localHttp = parsed.protocol === "http:"
    && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (
    (parsed.protocol !== "https:" && !localHttp)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("APP_ORIGIN must be a secure origin without a path, query, or credentials.");
  }
  return parsed.origin;
}

export function passwordRecoveryRedirectUrl(value: string | undefined): string {
  const url = new URL("/auth/confirm", parseAppOrigin(value));
  url.searchParams.set("next", "/reset-password");
  url.searchParams.set("type", "recovery");
  return url.toString();
}
