import {
  CANONICAL_FIELDS,
  FIELD_DETAILS,
  MAX_MAPPING_MERGE_COLUMNS,
  type CanonicalField,
} from "@/lib/csv/constants";

export type ColumnMapping = Record<CanonicalField, number | null>;
export type MappingStrategy = "direct" | "join_space" | "join_newline";
export type MappingRecipeEntry = {
  sources: number[];
  strategy: MappingStrategy;
};
export type MappingRecipe = Record<CanonicalField, MappingRecipeEntry | null>;
export type MappingState = "auto_mapped" | "suggested" | "needs_review" | "manually_confirmed";
export type MappingStates = Record<CanonicalField, MappingState>;

/** Strong aliases are intentionally conservative and safe to preselect. */
export const HEADER_ALIASES: Record<CanonicalField, readonly string[]> = {
  external_deal_id: [
    "external deal id",
    "deal id",
    "opportunity id",
    "quote id",
    "estimate id",
    "crm id",
    "record id",
    "opportunity number",
  ],
  customer_name: [
    "customer",
    "customer name",
    "client",
    "client name",
    "prospect",
    "prospect name",
    "account",
    "account name",
    "homeowner",
  ],
  deal_value: [
    "deal value",
    "value",
    "amount",
    "quoted amount",
    "quote amount",
    "quote total",
    "quote value",
    "estimate amount",
    "estimate total",
    "estimate value",
    "proposal value",
    "opportunity value",
    "opportunity size",
  ],
  quote_date: [
    "quote date",
    "quoted date",
    "estimate date",
    "proposal date",
    "created date",
  ],
  status: [
    "status",
    "outcome",
    "disposition",
    "deal status",
    "opportunity status",
    "result",
  ],
  salesperson: [
    "salesperson",
    "sales person",
    "sales rep",
    "rep",
    "sales representative",
    "closer",
    "sales owner",
    "opportunity owner",
  ],
  service_type: [
    "service",
    "service type",
    "job type",
    "product service",
    "project type",
    "system type",
  ],
  lead_source: [
    "source",
    "lead source",
    "marketing source",
    "acquisition source",
    "channel",
  ],
  sales_notes: [
    "sales notes",
    "notes",
    "comments",
    "crm notes",
    "rep notes",
    "rep comments",
    "call notes",
    "opportunity notes",
    "disposition notes",
  ],
  transcript: [
    "transcript",
    "call transcript",
    "conversation",
    "conversation transcript",
    "call recording transcript",
  ],
};

const WEAK_HEADER_ALIASES: Partial<Record<CanonicalField, readonly string[]>> = {
  customer_name: ["name", "company"],
  deal_value: ["price", "revenue", "estimate"],
  quote_date: ["date", "opportunity date"],
  salesperson: ["agent", "technician", "owner"],
  service_type: ["product", "product type", "project"],
  sales_notes: ["note", "sales comments", "conversation notes"],
};

const FIRST_NAME_ALIASES = new Set(["first name", "firstname", "given name"]);
const LAST_NAME_ALIASES = new Set(["last name", "lastname", "surname", "family name"]);
const NEWLINE_MERGE_FIELDS = new Set<CanonicalField>(["sales_notes", "transcript"]);

export function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function emptyColumnMapping(): ColumnMapping {
  return Object.fromEntries(CANONICAL_FIELDS.map((field) => [field, null])) as ColumnMapping;
}

export function emptyMappingRecipe(): MappingRecipe {
  return Object.fromEntries(CANONICAL_FIELDS.map((field) => [field, null])) as MappingRecipe;
}

export function emptyMappingStates(): MappingStates {
  return Object.fromEntries(
    CANONICAL_FIELDS.map((field) => [field, "needs_review"]),
  ) as MappingStates;
}

export function autoMapColumns(headers: readonly string[]): ColumnMapping {
  const mapping = emptyColumnMapping();
  const normalizedHeaders = headers.map(normalizeHeader);
  const used = new Set<number>();

  for (const field of CANONICAL_FIELDS) {
    const aliases = new Set(HEADER_ALIASES[field]);
    const index = normalizedHeaders.findIndex(
      (header, headerIndex) => !used.has(headerIndex) && aliases.has(header),
    );
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }

  return mapping;
}

export function columnMappingToRecipe(mapping: ColumnMapping): MappingRecipe {
  return Object.fromEntries(CANONICAL_FIELDS.map((field) => [
    field,
    mapping[field] === null
      ? null
      : { sources: [mapping[field] as number], strategy: "direct" as const },
  ])) as MappingRecipe;
}

export function createMappingPlan(headers: readonly string[]): {
  recipe: MappingRecipe;
  states: MappingStates;
} {
  const recipe = emptyMappingRecipe();
  const states = emptyMappingStates();
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();

  for (const field of CANONICAL_FIELDS) {
    const aliases = new Set(HEADER_ALIASES[field]);
    const matches = normalized
      .map((header, index) => ({ header, index }))
      .filter(({ header, index }) => !used.has(index) && aliases.has(header))
      .map(({ index }) => index);
    if (!matches.length) continue;

    if (NEWLINE_MERGE_FIELDS.has(field) && matches.length > 1) {
      const sources = matches.slice(0, MAX_MAPPING_MERGE_COLUMNS);
      recipe[field] = { sources, strategy: "join_newline" };
      states[field] = "suggested";
      sources.forEach((index) => used.add(index));
      continue;
    }

    recipe[field] = { sources: [matches[0]], strategy: "direct" };
    states[field] = "auto_mapped";
    used.add(matches[0]);
  }

  if (!recipe.customer_name) {
    const first = normalized.findIndex((header, index) => !used.has(index) && FIRST_NAME_ALIASES.has(header));
    const last = normalized.findIndex((header, index) => !used.has(index) && LAST_NAME_ALIASES.has(header));
    if (first >= 0 && last >= 0) {
      recipe.customer_name = { sources: [first, last], strategy: "join_space" };
      states.customer_name = "suggested";
      used.add(first);
      used.add(last);
    }
  }

  for (const field of CANONICAL_FIELDS) {
    if (recipe[field]) continue;
    const weakAliases = new Set(WEAK_HEADER_ALIASES[field] ?? []);
    const index = normalized.findIndex(
      (header, headerIndex) => !used.has(headerIndex) && weakAliases.has(header),
    );
    if (index >= 0) {
      recipe[field] = { sources: [index], strategy: "direct" };
      states[field] = "suggested";
      used.add(index);
    }
  }

  return { recipe, states };
}

export function usedSourceColumns(recipe: MappingRecipe): Set<number> {
  return new Set(CANONICAL_FIELDS.flatMap((field) => recipe[field]?.sources ?? []));
}

export function ignoredSourceColumns(headers: readonly string[], recipe: MappingRecipe): number[] {
  const used = usedSourceColumns(recipe);
  return headers.map((_, index) => index).filter((index) => !used.has(index));
}

export function validateColumnMapping(
  mapping: ColumnMapping,
  headerCount: number,
): string[] {
  const errors: string[] = [];
  const mapped = new Map<number, CanonicalField>();

  for (const field of CANONICAL_FIELDS) {
    const columnIndex = mapping[field];
    if (columnIndex === null) continue;
    if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= headerCount) {
      errors.push(`${FIELD_DETAILS[field].label} has an invalid source column.`);
      continue;
    }
    const existingField = mapped.get(columnIndex);
    if (existingField) {
      errors.push(
        `One CSV column cannot map to both ${FIELD_DETAILS[existingField].label} and ${FIELD_DETAILS[field].label}.`,
      );
    } else {
      mapped.set(columnIndex, field);
    }
  }

  if (mapping.deal_value === null) errors.push("Map a CSV column to Deal value.");
  if (mapping.sales_notes === null && mapping.transcript === null) {
    errors.push(
      "LostDeal AI needs sales notes or a transcript to understand why a deal was lost.",
    );
  }

  return errors;
}

export function validateMappingRecipe(recipe: MappingRecipe, headerCount: number): string[] {
  const errors: string[] = [];
  const used = new Map<number, CanonicalField>();

  for (const field of CANONICAL_FIELDS) {
    const entry = recipe[field];
    if (!entry) continue;
    if (!Array.isArray(entry.sources) || entry.sources.length < 1 || entry.sources.length > MAX_MAPPING_MERGE_COLUMNS) {
      errors.push(`${FIELD_DETAILS[field].label} has an invalid source selection.`);
      continue;
    }
    if (new Set(entry.sources).size !== entry.sources.length) {
      errors.push(`${FIELD_DETAILS[field].label} cannot reuse the same source column.`);
    }
    for (const source of entry.sources) {
      if (!Number.isInteger(source) || source < 0 || source >= headerCount) {
        errors.push(`${FIELD_DETAILS[field].label} has an invalid source column.`);
        continue;
      }
      const existing = used.get(source);
      if (existing && existing !== field) {
        errors.push(`One CSV column cannot map to both ${FIELD_DETAILS[existing].label} and ${FIELD_DETAILS[field].label}.`);
      } else {
        used.set(source, field);
      }
    }

    if (entry.strategy === "direct" && entry.sources.length !== 1) {
      errors.push(`${FIELD_DETAILS[field].label} direct mapping requires one source column.`);
    } else if (entry.strategy === "join_space" && (field !== "customer_name" || entry.sources.length < 2)) {
      errors.push("Space joining is supported only for Customer name with at least two source columns.");
    } else if (entry.strategy === "join_newline" && (!NEWLINE_MERGE_FIELDS.has(field) || entry.sources.length < 2)) {
      errors.push("Source-labelled merging is supported only for Sales notes or Transcript with at least two source columns.");
    } else if (!(["direct", "join_space", "join_newline"] as string[]).includes(entry.strategy)) {
      errors.push(`${FIELD_DETAILS[field].label} has an unsupported mapping strategy.`);
    }
  }

  if (!recipe.deal_value) errors.push("Map a CSV column to Deal value.");
  if (!recipe.sales_notes && !recipe.transcript) {
    errors.push("This deal has no sales notes or transcript to analyze. Map an available comments/notes column or correct the source file.");
  }
  return Array.from(new Set(errors));
}

export function parseColumnMapping(value: unknown, headerCount: number): ColumnMapping | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !CANONICAL_FIELDS.includes(key as CanonicalField))) return null;
  const mapping = emptyColumnMapping();

  for (const field of CANONICAL_FIELDS) {
    const columnIndex = candidate[field];
    if (columnIndex === null) {
      mapping[field] = null;
    } else if (
      typeof columnIndex === "number" &&
      Number.isInteger(columnIndex) &&
      columnIndex >= 0 &&
      columnIndex < headerCount
    ) {
      mapping[field] = columnIndex;
    } else {
      return null;
    }
  }

  return mapping;
}

export function parseMappingRecipe(value: unknown, headerCount: number): MappingRecipe | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !CANONICAL_FIELDS.includes(key as CanonicalField))) return null;

  const legacy = CANONICAL_FIELDS.every((field) => candidate[field] === null || typeof candidate[field] === "number");
  if (legacy) {
    const mapping = parseColumnMapping(value, headerCount);
    return mapping ? columnMappingToRecipe(mapping) : null;
  }

  const recipe = emptyMappingRecipe();
  for (const field of CANONICAL_FIELDS) {
    const raw = candidate[field];
    if (raw === null) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;
    if (Object.keys(entry).some((key) => !["sources", "strategy"].includes(key))) return null;
    if (!Array.isArray(entry.sources) || !entry.sources.every((source) => typeof source === "number" && Number.isInteger(source))) return null;
    if (!(["direct", "join_space", "join_newline"] as unknown[]).includes(entry.strategy)) return null;
    recipe[field] = {
      sources: [...entry.sources] as number[],
      strategy: entry.strategy as MappingStrategy,
    };
  }
  return validateMappingRecipe(recipe, headerCount).some((error) => /invalid source|unsupported|cannot reuse|cannot map to both|requires one|supported only/i.test(error))
    ? null
    : recipe;
}
