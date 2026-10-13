import { z } from "zod";
import details from "@/lib/marketing/launch-details.json";

const placeholderContent = /[\[\]<>]|\{\{|\}\}|\bowner\s*(?:required\b|:)|\b(?:tbd|todo|placeholder|dummy|unresolved|example|draft|lorem ipsum)\b|\bqa\s+(?:seller|address|law|forum)\b|[\u0000-\u001f\u007f]/i;
const dummyValue = /^(?:test|sample|unknown|none|n\/a|not set|pending)$/i;
const finalText = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum)
  .refine(value => !placeholderContent.test(value) && !dummyValue.test(value), "Complete approved publication content is required.");
const contactEmail = z.string().trim().pipe(z.email()).refine(value => {
  const separator = value.lastIndexOf("@");
  if (separator < 1) return false;
  const domain = value.slice(separator + 1).toLowerCase();
  return !/(?:^|\.)(?:example\.(?:com|net|org)|example|invalid|test|localhost|local)$/.test(domain)
    && !placeholderContent.test(value) && !dummyValue.test(value.slice(0, separator));
}, "An approved public contact is required.");

export const LaunchDetailsSchema = z.strictObject({
  approved: z.literal(true),
  sellerName: finalText(2, 200),
  sellerStructure: z.literal("Individual / Sole Proprietor — Pakistan"),
  sellerLocality: finalText(5, 500),
  sellerCountry: finalText(2, 100),
  supportEmail: contactEmail,
  privacyEmail: contactEmail,
  governingLaw: finalText(2, 200),
  disputeForum: finalText(2, 300),
  effectiveDate: z.iso.date(),
  refundPolicy: finalText(30, 4000),
});
export type LaunchDetails = z.infer<typeof LaunchDetailsSchema>;
export function resolveLaunchDetails(input: unknown): LaunchDetails | null {
  const parsed = LaunchDetailsSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
// A draft cannot create published policies, an invented contact or a fake support form.
export const approvedLaunchDetails = resolveLaunchDetails(details);
