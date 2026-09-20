import { NextResponse } from "next/server";

import { DEAL_IMPORT_BATCH_SIZE } from "@/lib/csv/constants";
import {
  commitOrganizationUsage,
  reserveOrganizationUsage,
  type UsageReservation,
} from "@/lib/billing/usage";
import { CsvImportError, validateCsvFormData } from "@/lib/csv/server";
import { mutationIssueResponse, validateMutationRequest } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";
import { createClient } from "@/lib/supabase/server";

function friendlyImportFailure(error: { code?: string; message?: string } | null): string {
  if (error?.code === "23505") {
    return "A deal ID was imported by another request. Review the CSV and try again.";
  }
  return "The database could not finish this import. No completion was reported.";
}

export async function POST(request: Request) {
  let uploadId: string | null = null;
  let organizationId: string | null = null;
  let insertedCount = 0;
  let importClient: Awaited<ReturnType<typeof createClient>> | null = null;
  let usageReservation: UsageReservation | null = null;

  try {
    const requestIssue = validateMutationRequest(request, "multipart");
    if (requestIssue) return mutationIssueResponse(requestIssue);
    const authorization = await getAuthorizedRouteContext();
    if (authorization.response) return authorization.response;
    const { supabase, identity, organization } = authorization.context;
    importClient = supabase;
    organizationId = organization.id;
    const limited = await enforceRateLimitOrRespond(identity.id, "upload_import");
    if (limited) return limited;

    const result = await validateCsvFormData(
      await request.formData(),
      supabase,
      organization.id,
      { allowConfirmation: true },
    );
    const { validation } = result;
    if (!validation.readyRows.length) {
      throw new CsvImportError("All rows are invalid. Correct the CSV before importing.", 422);
    }
    const skippedRows = validation.needsReviewRows.length + validation.invalidRows.length;
    if (skippedRows > 0 && !result.skipConfirmed) {
      throw new CsvImportError(
        `Confirm that ${skippedRows} review or invalid ${skippedRows === 1 ? "row will" : "rows will"} be skipped before importing.`,
        422,
      );
    }

    uploadId = crypto.randomUUID();
    usageReservation = await reserveOrganizationUsage(
      supabase,
      organization.id,
      "IMPORTED_DEALS",
      validation.readyRows.length,
      `import:${uploadId}`,
    );
    if (!usageReservation.allowed) {
      return NextResponse.json(
        { error: "This workspace does not have enough remaining Imported Deals allowance." },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (!usageReservation.isNew) {
      return NextResponse.json(
        { error: "This import is already being processed." },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const { error: pendingError } = await supabase.from("uploads").insert({
      id: uploadId,
      organization_id: organization.id,
      filename: result.filename,
      total_rows: validation.totalRows,
      valid_rows: validation.readyRows.length,
      invalid_rows: skippedRows,
      status: "pending",
      created_by: identity.id,
    });
    if (pendingError) {
      return NextResponse.json(
        { error: "LostDeal AI could not create the import record. Please try again." },
        { status: 503 },
      );
    }

    const { error: processingError } = await supabase
      .from("uploads")
      .update({ status: "processing" })
      .eq("id", uploadId)
      .eq("organization_id", organization.id);
    if (processingError) {
      await supabase
        .from("uploads")
        .update({ status: "failed", valid_rows: 0 })
        .eq("id", uploadId)
        .eq("organization_id", organization.id);
      return NextResponse.json(
        { error: "The import could not start. Its status was recorded as failed." },
        { status: 503 },
      );
    }

    for (let offset = 0; offset < validation.readyRows.length; offset += DEAL_IMPORT_BATCH_SIZE) {
      const batch = validation.readyRows.slice(offset, offset + DEAL_IMPORT_BATCH_SIZE).map((row) => ({
        id: crypto.randomUUID(),
        organization_id: organization.id,
        upload_id: uploadId,
        external_deal_id: row.external_deal_id,
        customer_name: row.customer_name,
        deal_value: row.deal_value,
        quote_date: row.quote_date,
        status: "lost",
        salesperson: row.salesperson,
        service_type: row.service_type,
        lead_source: row.lead_source,
        sales_notes: row.sales_notes,
        transcript: row.transcript,
      }));

      const { error: insertError } = await supabase.from("deals").insert(batch);
      if (insertError) {
        await supabase
          .from("uploads")
          .update({ status: "failed", valid_rows: insertedCount })
          .eq("id", uploadId)
          .eq("organization_id", organization.id);
        return NextResponse.json(
          {
            error: `${friendlyImportFailure(insertError)} ${insertedCount} of ${validation.readyRows.length} deals were inserted before the failure.`,
            uploadId,
            insertedCount,
            status: "failed",
          },
          { status: insertError.code === "23505" ? 409 : 503 },
        );
      }
      insertedCount += batch.length;
    }

    const { error: completedError } = await supabase
      .from("uploads")
      .update({ status: "completed" })
      .eq("id", uploadId)
      .eq("organization_id", organization.id);
    if (completedError) {
      await supabase
        .from("uploads")
        .update({ status: "failed", valid_rows: insertedCount })
        .eq("id", uploadId)
        .eq("organization_id", organization.id);
      return NextResponse.json(
        {
          error: `${insertedCount} deals were inserted, but final status verification failed. The import is marked failed for review.`,
          uploadId,
          insertedCount,
          status: "failed",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      success: true,
      uploadId,
      filename: result.filename,
      organizationName: organization.name,
      totalRows: validation.totalRows,
      insertedCount,
      invalidRows: skippedRows,
      status: "completed",
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    if (uploadId && organizationId && importClient) {
      await importClient
        .from("uploads")
        .update({ status: "failed", valid_rows: insertedCount })
        .eq("id", uploadId)
        .eq("organization_id", organizationId);
    }
    if (error instanceof CsvImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error: uploadId
          ? `The import failed after ${insertedCount} deals. Its status was recorded for review.`
          : "LostDeal AI could not import this CSV. Please try again.",
      },
      { status: 500 },
    );
  } finally {
    if (usageReservation && importClient && organizationId && insertedCount > 0) {
      await commitOrganizationUsage(
        importClient,
        organizationId,
        usageReservation,
        insertedCount,
      ).catch(() => false);
    }
  }
}
