import { NextResponse } from "next/server";
import { getBillingEnforcementMode, getBillingUsageAuthoritySecret } from "@/lib/billing/config";
import { CsvImportError, validateCsvFormData, parseCsvUploadFile } from "@/lib/csv/server";
import { fingerprint, OPERATION_ID_PATTERN } from "@/lib/csv/operation-service";
import { validateImportWithReplay } from "@/lib/csv/import-replay";
import { mutationIssueResponse, validateMutationRequest } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";

export async function POST(request: Request) {
  try {
    const issue = validateMutationRequest(request, "multipart");
    if (issue) return mutationIssueResponse(issue);
    const auth = await getAuthorizedRouteContext();
    if (auth.response) return auth.response;
    const { supabase, identity, organization } = auth.context;
    const limited = await enforceRateLimitOrRespond(identity.id, "upload_import");
    if (limited) return limited;
    const uploadId = request.headers.get("idempotency-key");
    if (!uploadId || !OPERATION_ID_PATTERN.test(uploadId)) throw new CsvImportError("A valid import operation is required.");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new CsvImportError("Choose a CSV file to continue.");
    await parseCsvUploadFile(file);
    const hash = await fingerprint(file, [...form.entries()].filter(([key]) => key !== "file"));
    const readReplay = async () => {
      const previous = await supabase.from("uploads").select("id,request_fingerprint,status,filename,total_rows,valid_rows,invalid_rows,created_at")
        .eq("organization_id", organization.id).eq("id", uploadId).maybeSingle();
      if (previous.error) throw new CsvImportError("Import state is temporarily unavailable. Retry the same request.", 503);
      if (previous.data) {
        const row = previous.data;
        if (row.request_fingerprint !== hash || row.status !== "completed") throw new CsvImportError("This import operation belongs to different input.", 409);
        return NextResponse.json({ success: true, uploadId, filename: row.filename, organizationName: organization.name,
          totalRows: row.total_rows, insertedCount: row.valid_rows, invalidRows: row.invalid_rows, status: "completed", createdAt: row.created_at });
      }
      return null;
    };
    const prepared = await validateImportWithReplay(readReplay,
      () => validateCsvFormData(form, supabase, organization.id, { allowConfirmation: true }));
    if (prepared.replay) return prepared.replay;
    const result = prepared.validation;
    if (!result) throw new CsvImportError("Import state could not be verified. Retry the same operation.",503);
    const { validation } = result;
    if (!validation.readyRows.length) throw new CsvImportError("All rows are invalid. Correct the CSV before importing.", 422);
    const skipped = validation.needsReviewRows.length + validation.invalidRows.length;
    if (skipped && !result.skipConfirmed) throw new CsvImportError("Confirm that review or invalid rows will be skipped before importing.", 422);
    const secret = getBillingUsageAuthoritySecret();
    if (!secret) throw new CsvImportError("Import usage metering is temporarily unavailable.", 503);
    const rows = validation.readyRows.map(row => ({
      external_deal_id: row.external_deal_id, customer_name: row.customer_name, deal_value: row.deal_value,
      quote_date: row.quote_date, salesperson: row.salesperson, service_type: row.service_type,
      lead_source: row.lead_source, sales_notes: row.sales_notes, transcript: row.transcript,
    }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase.rpc("persist_deal_import", {
        target_authority_secret: secret, target_organization_id: organization.id, target_upload_id: uploadId,
        target_fingerprint: hash, target_filename: result.filename, target_total_rows: validation.totalRows,
        target_skipped_rows: skipped, target_rows: rows, target_enforced: getBillingEnforcementMode() === "ENFORCED",
      });
      if (!error && data && typeof data === "object") return NextResponse.json({ ...data, success: true, organizationName: organization.name, status: "completed" });
      if (error?.message === "IMPORT_QUOTA_EXCEEDED") throw new CsvImportError("This workspace does not have enough remaining Imported Deals allowance.", 403);
      if (error?.code === "23505") throw new CsvImportError("A deal ID or import operation conflicts with existing data. Review the CSV.", 409);
    }
    throw new CsvImportError("Import completion could not be verified. Retry the same operation; it will not insert or charge twice.", 503);
  } catch (error) {
    return NextResponse.json({ error: error instanceof CsvImportError ? error.message : "The import could not be completed. Retry the same operation." },
      { status: error instanceof CsvImportError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
