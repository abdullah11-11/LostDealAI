export const MAX_CSV_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 2_000;
export const MAX_CSV_FILENAME_LENGTH = 180;
export const MAX_CSV_HEADER_LENGTH = 200;
export const DEAL_IMPORT_BATCH_SIZE = 200;
export const VALIDATION_PREVIEW_ROWS = 8;
export const MAX_MAPPING_MERGE_COLUMNS = 5;
export const MAX_REVIEW_ROWS_RETURNED = 100;
export const MAX_AI_MAPPING_COLUMNS = 60;
export const MAX_AI_MAPPING_SAMPLES_PER_COLUMN = 3;
export const MAX_AI_MAPPING_SAMPLE_LENGTH = 120;

export const CANONICAL_FIELDS = [
  "external_deal_id",
  "customer_name",
  "deal_value",
  "quote_date",
  "status",
  "salesperson",
  "service_type",
  "lead_source",
  "sales_notes",
  "transcript",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export const FIELD_DETAILS: Record<
  CanonicalField,
  { label: string; description: string; required?: boolean }
> = {
  external_deal_id: {
    label: "External deal ID",
    description: "Your CRM, quote, or estimate identifier.",
  },
  customer_name: {
    label: "Customer name",
    description: "Optional customer or company label.",
  },
  deal_value: {
    label: "Deal value",
    description: "Required. Currency formatting is normalized safely.",
    required: true,
  },
  quote_date: {
    label: "Quote date",
    description: "ISO dates are preferred; ambiguous dates require review.",
  },
  status: {
    label: "Status",
    description: "Blank defaults to lost. Won deals are excluded.",
  },
  salesperson: {
    label: "Salesperson",
    description: "The sales representative or technician.",
  },
  service_type: {
    label: "Service type",
    description: "The service, job, or product quoted.",
  },
  lead_source: {
    label: "Lead source",
    description: "The channel that created the opportunity.",
  },
  sales_notes: {
    label: "Sales notes",
    description: "Required unless a transcript is mapped.",
  },
  transcript: {
    label: "Transcript",
    description: "Required unless sales notes are mapped.",
  },
};

export const FIELD_MAX_LENGTHS: Record<CanonicalField, number> = {
  external_deal_id: 120,
  customer_name: 200,
  deal_value: 40,
  quote_date: 80,
  status: 80,
  salesperson: 160,
  service_type: 160,
  lead_source: 160,
  sales_notes: 10_000,
  transcript: 100_000,
};
