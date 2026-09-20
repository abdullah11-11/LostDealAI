# Smart Import

Smart Import converts an existing CSV into LostDeal AI's ten canonical deal
fields without changing the original file. The same server-side mapping,
normalization, and validation pipeline is used for review, normalized CSV
download, and final import.

## Mapping

Header matching is deterministic and runs first. Strong aliases such as
`Opportunity ID`, `Quoted Amount`, `Estimate Date`, `Rep`, and `Call Notes` are
auto-mapped with zero OpenAI calls. Weak matches and multi-column merges are
marked Suggested and require confirmation. Every mapping remains editable, and
extra source columns remain visible as Ignored columns rather than being stored.

Supported recipes are deliberately narrow:

- `direct`: one source column to one canonical field.
- `join_space`: up to five name columns into `customer_name`.
- `join_newline`: up to five source-labelled text columns into `sales_notes` or
  `transcript`.

No client-supplied code or arbitrary transformations are accepted. A source
column cannot feed multiple canonical fields.

## Normalization and review

Deal values accept common USD formatting and reject negative, malformed, or
ambiguous foreign formats. Dates normalize to `YYYY-MM-DD`; ambiguous numeric
dates remain Needs Review until the user selects their source format. Clear lost
status aliases normalize to `lost`; known won/sold values are Invalid; unknown
values require an explicit Lost or Exclude decision.

Missing optional values remain blank. In particular, customer names are never
invented. A row without both Sales Notes and Transcript is Invalid because it
does not contain source context for later analysis. Existing external-deal-ID
duplicate protection remains organization scoped.

## Optional AI suggestions

`Suggest Mapping with AI` is an explicit convenience, never an automatic step.
It sends at most 60 candidate column names, a lightweight inferred profile, and
up to three representative values of 120 characters each. It never sends the
full CSV, user or organization identifiers, cookies, sessions, existing deals,
analyses, or Recovery Scores. CSV content is treated as untrusted data.

The provider response uses strict Structured Outputs and can target only the ten
canonical fields or `IGNORE`. The server validates every suggestion before it
is shown, and the user must choose whether to apply and confirm it. One click
causes at most one provider request; the existing distributed D1 rate limiter
allows six mapping requests per ten minutes per authenticated user. Failure does
not block deterministic or manual mapping.

## Normalized CSV download

`Download LostDeal-formatted CSV` reparses the selected file on the server and
exports only Ready rows with the exact canonical header order. Review and
Invalid rows are excluded with an explicit count. Spreadsheet formula-like text
is made inert, and the output filename is sanitized. Downloading does not write
to Supabase, start an import, run deal analysis, or calculate Recovery Scores.
Raw and generated CSV bytes are not retained by the application.

## Limits

Smart Import accepts UTF-8 `.csv` files up to 5 MB and 2,000 data rows. It does
not import XLSX, PDF, DOCX, images, or CRM APIs; extract structured facts from a
free-form blob; enrich customer data; or save mapping templates. Refreshing or
navigating away may require the browser file to be selected again.
