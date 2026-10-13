"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { primaryOrganizationIdForUser } from "@/lib/auth/organization-id";
import { getActiveOrganization, getVerifiedIdentity } from "@/lib/auth/server";
import {
  friendlyLoginError,
  friendlySignupError,
  getSafeNextPath,
  hasFieldErrors,
  isUniqueConflict,
  type FormActionState,
  validateLogin,
  validateOnboarding,
  validateSignup,
} from "@/lib/auth/validation";
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_COOKIE_VALUE,
  PASSWORD_RESET_GENERIC_MESSAGE,
  passwordRecoveryRateKey,
  passwordRecoveryRedirectUrl,
  validateNewPassword,
  validateRecoveryEmail,
} from "@/lib/auth/password-recovery";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export async function forgotPasswordAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const { email, fieldErrors } = validateRecoveryEmail(formData);
  if (hasFieldErrors(fieldErrors)) return { fieldErrors };

  try {
    const decision = await enforceRateLimit(
      await passwordRecoveryRateKey(email),
      "forgot_password",
    );
    if (!decision.allowed) {
      return { formError: "Too many reset requests. Wait 15 minutes and try again." };
    }
  } catch {
    return { formError: "Password recovery is temporarily unavailable. Please try again shortly." };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: passwordRecoveryRedirectUrl(process.env.APP_ORIGIN),
  });

  // The response is deliberately identical for known and unknown addresses.
  return { formSuccess: PASSWORD_RESET_GENERIC_MESSAGE };
}

export async function resetPasswordAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const { password, fieldErrors } = validateNewPassword(formData);
  if (hasFieldErrors(fieldErrors)) return { fieldErrors };

  const cookieStore = await cookies();
  if (cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value !== PASSWORD_RECOVERY_COOKIE_VALUE) {
    return { formError: "This recovery link is invalid or has expired. Request a new link." };
  }

  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);
  if (!identity) {
    cookieStore.delete(PASSWORD_RECOVERY_COOKIE);
    return { formError: "This recovery link is invalid or has expired. Request a new link." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { formError: "Your password could not be updated. Request a new link and try again." };
  }

  cookieStore.delete(PASSWORD_RECOVERY_COOKIE);
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login?reset=success");
}

export async function loginAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const { email, password, fieldErrors } = validateLogin(formData);
  if (hasFieldErrors(fieldErrors)) return { fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { formError: friendlyLoginError(error) };

  const identity = await getVerifiedIdentity(supabase);
  if (!identity) {
    await supabase.auth.signOut({ scope: "local" });
    return { formError: "We could not verify your session. Please try again." };
  }

  let organization: Awaited<ReturnType<typeof getActiveOrganization>>;
  try {
    organization = await getActiveOrganization(supabase, identity.id);
  } catch {
    return { formError: "We could not load your workspace. Please try again shortly." };
  }
  if (!organization) redirect(`/onboarding?next=${encodeURIComponent(getSafeNextPath(String(formData.get("next") ?? "")))}`);

  const nextValue = formData.get("next");
  redirect(getSafeNextPath(typeof nextValue === "string" ? nextValue : null));
}

export async function signupAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const { fullName, email, password, fieldErrors } = validateSignup(formData);
  if (hasFieldErrors(fieldErrors)) return { fieldErrors };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) return { formError: friendlySignupError(error) };
  if (!data.session) redirect("/signup/check-email");

  const identity = await getVerifiedIdentity(supabase);
  if (!identity) {
    await supabase.auth.signOut({ scope: "local" });
    return { formError: "Your account was created, but the session could not be verified. Log in to continue." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", identity.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { formError: "Your account was created, but profile setup could not be completed. Please try again." };
  }

  if (!profile.full_name?.trim()) {
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", identity.id);
    if (updateError) {
      return { formError: "Your account was created, but your name could not be saved. Please try again." };
    }
  }

  let organization: Awaited<ReturnType<typeof getActiveOrganization>>;
  try {
    organization = await getActiveOrganization(supabase, identity.id);
  } catch {
    return { formError: "Your account was created, but workspace setup is temporarily unavailable." };
  }
  const destination = getSafeNextPath(String(formData.get("next") ?? ""));
  redirect(organization ? destination : `/onboarding?next=${encodeURIComponent(destination)}`);
}

export async function onboardingAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);
  if (!identity) redirect("/login?next=%2Fonboarding");

  let existingMembership: Awaited<ReturnType<typeof getActiveOrganization>>;
  try {
    existingMembership = await getActiveOrganization(supabase, identity.id);
  } catch {
    return { formError: "We could not check your workspace. Please try again shortly." };
  }
  if (existingMembership) redirect(getSafeNextPath(String(formData.get("next") ?? "")));

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", identity.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { formError: "We could not load your profile. Please refresh and try again." };
  }

  const fullNameRequired = !profile.full_name?.trim();
  const { businessName, industry, fullName, fieldErrors } = validateOnboarding(
    formData,
    fullNameRequired,
  );
  if (hasFieldErrors(fieldErrors)) return { fieldErrors };

  if (fullNameRequired) {
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", identity.id);
    if (updateError) {
      return { formError: "We could not save your name. Please try again." };
    }
  }

  const { data: pendingOrganization, error: pendingError } = await supabase
    .from("organizations")
    .select("id")
    .eq("created_by", identity.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (pendingError) {
    return { formError: "We could not check your workspace setup. Please try again." };
  }

  let organizationId = pendingOrganization?.id;
  if (!organizationId) {
    organizationId = await primaryOrganizationIdForUser(identity.id);
    const { error: organizationError } = await supabase.from("organizations").insert({
      id: organizationId,
      name: businessName,
      industry,
      created_by: identity.id,
    });

    if (organizationError && !isUniqueConflict(organizationError)) {
      return { formError: "We could not create your workspace. Please try again." };
    }
  }

  const { error: membershipError } = await supabase.from("organization_members").insert({
    organization_id: organizationId,
    user_id: identity.id,
    role: "owner",
  });

  if (membershipError && !isUniqueConflict(membershipError)) {
    return { formError: "Your workspace was saved, but setup could not finish. Submit again to safely continue." };
  }

  let completedOrganization: Awaited<ReturnType<typeof getActiveOrganization>>;
  try {
    completedOrganization = await getActiveOrganization(supabase, identity.id);
  } catch {
    return { formError: "Your workspace was saved, but verification is temporarily unavailable. Please try again." };
  }
  if (!completedOrganization) {
    return { formError: "Workspace setup could not be verified. Please submit again." };
  }

  redirect(getSafeNextPath(String(formData.get("next") ?? "")));
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error("Sign out could not be completed. Please try again.");
  redirect("/login");
}
