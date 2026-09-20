export const INDUSTRIES = [
  "HVAC",
  "Plumbing",
  "Roofing",
  "Electrical",
  "Pest Control",
  "Landscaping",
  "Cleaning",
  "Other",
] as const;

export type Industry = (typeof INDUSTRIES)[number];

export type FieldErrors = Partial<
  Record<"fullName" | "email" | "password" | "passwordConfirmation" | "businessName" | "industry", string>
>;

export type FormActionState = {
  fieldErrors?: FieldErrors;
  formError?: string;
  formSuccess?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function textValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function validateLogin(formData: FormData) {
  const email = textValue(formData, "email").toLowerCase();
  const passwordValue = formData.get("password");
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const fieldErrors: FieldErrors = {};

  if (!email) fieldErrors.email = "Enter your business email.";
  else if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  if (!password) fieldErrors.password = "Enter your password.";

  return { email, password, fieldErrors };
}

export function validateSignup(formData: FormData) {
  const fullName = textValue(formData, "fullName").replace(/\s+/g, " ");
  const { email, password, fieldErrors } = validateLogin(formData);

  if (!fullName) fieldErrors.fullName = "Enter your full name.";
  else if (fullName.length > 100) {
    fieldErrors.fullName = "Keep your full name under 100 characters.";
  }

  if (password && password.length < 8) {
    fieldErrors.password = "Use at least 8 characters.";
  } else if (password.length > 128) {
    fieldErrors.password = "Keep your password under 128 characters.";
  }

  return { fullName, email, password, fieldErrors };
}

export function validateOnboarding(formData: FormData, fullNameRequired: boolean) {
  const businessName = textValue(formData, "businessName").replace(/\s+/g, " ");
  const industry = textValue(formData, "industry");
  const fullName = textValue(formData, "fullName").replace(/\s+/g, " ");
  const fieldErrors: FieldErrors = {};

  if (!businessName) fieldErrors.businessName = "Enter your business name.";
  else if (businessName.length > 120) {
    fieldErrors.businessName = "Keep the business name under 120 characters.";
  }

  if (!INDUSTRIES.includes(industry as Industry)) {
    fieldErrors.industry = "Choose an industry.";
  }

  if (fullNameRequired) {
    if (!fullName) fieldErrors.fullName = "Enter your full name.";
    else if (fullName.length > 100) {
      fieldErrors.fullName = "Keep your full name under 100 characters.";
    }
  }

  return {
    businessName,
    industry: industry as Industry,
    fullName,
    fieldErrors,
  };
}

export function hasFieldErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

const APP_DESTINATIONS = ["/dashboard", "/deals", "/upload", "/account", "/onboarding"];

/** Allows only same-application paths and rejects protocol-relative URLs. */
export function getSafeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  try {
    const parsed = new URL(value, "https://lostdeal.local");
    const allowed = APP_DESTINATIONS.some(
      (path) => parsed.pathname === path || parsed.pathname.startsWith(`${path}/`),
    );

    return parsed.origin === "https://lostdeal.local" && allowed
      ? `${parsed.pathname}${parsed.search}`
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export function friendlySignupError(error: unknown): string {
  const code = errorCode(error);

  if (code === "weak_password") {
    return "That password does not meet the security requirements.";
  }
  if (code === "email_address_invalid") {
    return "Enter a valid business email address.";
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
    return "Too many attempts. Wait a moment and try again.";
  }

  return "We could not create your account. Try logging in or try again shortly.";
}

export function isUniqueConflict(error: unknown): boolean {
  return errorCode(error) === "23505";
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const value = error.code;
  return typeof value === "string" ? value : undefined;
}
