import { billingMutation } from "@/lib/billing/routes";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return billingMutation(request, "change-plan"); }
