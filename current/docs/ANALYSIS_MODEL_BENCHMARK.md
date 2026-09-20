# LostDeal AI analysis model benchmark

Research date: **2026-09-02**
Decision: **Standard — `gpt-5.6-terra`; Deep — `gpt-5.6-terra`; Auto Convert — keep `gpt-5.6-luna`.**

This benchmark is a pre-release quality and cost gate, not a provider guarantee. It uses only synthetic deal records. No customer data, organization identifiers, auth data, Recovery Scores, credentials, or raw provider payloads were used or retained.

## Method

- API: OpenAI Responses API with Structured Outputs and `store: false`.
- Reasoning effort: `low` for every model/mode comparison.
- Standard prompt/schema: `standard-1.0` / `standard-1.0`.
- Deep prompt/schema: `deep-1.0` / `deep-1.0`.
- Standard candidates: `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`.
- Deep candidates: `gpt-5.6-terra`, `gpt-5.6-sol`.
- Deterministic rubric: primary reason, exact evidence grounding, required evidence, forbidden claims, buying-intent range, probability safety, and Deep-only blocker/timing/price/competitor/decision/discount/strategy checks.
- Human-authored expectations remain authoritative. No evaluator model selected the winner.

The versioned dataset contains **12 synthetic cases**: financing, true price/competitor, timing, decision maker, competitor, no follow-up, no response with prompt injection, trust, product fit, availability, a long multiple-blocker case, and weak evidence. It includes notes-only, transcript-only, combined, short, long, conflicting/nuanced, and obvious source shapes.

Stage 1 deliberately concentrated live calls on four high-discrimination cases: financing versus price, true competitor price loss, long multiple blockers, and weak evidence. The remaining cases stay in the deterministic benchmark fixture for regression and future re-evaluation.

## Confirmed live results

Exactly **20 completed Stage 1 provider calls** produced auditable results: 12 Standard and 8 Deep. They used **34,164 input tokens**, **10,656 output tokens**, and **$0.246432** at the official standard rates checked on the research date.

| Mode | Model | Cases | Rubric checks | Input tokens | Output tokens | Mean latency | Observed cost |
|---|---|---:|---:|---:|---:|---:|---:|
| Standard | `gpt-5.6-luna` | 4 | 24/24 | 4,484 | 1,066 | 9,131 ms | $0.002176 |
| Standard | `gpt-5.6-terra` | 4 | 24/24 | 4,484 | 950 | 4,241 ms | $0.020368 |
| Standard | `gpt-5.6-sol` | 4 | 24/24 | 4,484 | 984 | 5,299 ms | $0.037616 |
| Deep | `gpt-5.6-terra` | 4 | 52/56 | 10,356 | 3,623 | 9,511 ms | $0.064188 |
| Deep | `gpt-5.6-sol` | 4 | 53/56 | 10,356 | 4,033 | 13,386 ms | $0.122084 |

| Case | Standard Luna | Standard Terra | Standard Sol | Deep Terra | Deep Sol |
|---|---:|---:|---:|---:|---:|
| Financing, not discount | 6/6 | 6/6 | 6/6 | 14/14 | 14/14 |
| True price + competitor | 6/6 | 6/6 | 6/6 | 10/14 | 11/14 |
| Long multiple blockers | 6/6 | 6/6 | 6/6 | 14/14 | 14/14 |
| Weak evidence | 6/6 | 6/6 | 6/6 | 14/14 | 14/14 |

All models correctly kept the financing case as `FINANCING`, grounded the monthly-payment evidence, and avoided prescribing a discount. Both Deep candidates correctly separated `FINANCING` from the `TIMING` and `DECISION_MAKER` secondary blockers in the long case. All candidates handled “Didn't close” cautiously without inventing a story.

In the explicit lower-price competitor case, both Deep candidates chose `COMPETITOR` as primary and `PRICE` as secondary, while the gold contract requires `PRICE` primary when the source says final price decided the outcome. Sol passed one additional negative decision-maker check; that one-check difference did not create a material strategic-quality advantage. The final pre-release Deep instructions now state this price-primary rule and clarify that selecting another provider alone is not decision-maker evidence.

An optional Stage 2 process was launched after Stage 1 because the one-check Deep difference was initially ambiguous. Work-platform policy terminated the process before returning any auditable result. It was not retried, and no Stage 2 result or cost is claimed. For conservative budget control, the run was treated as potentially attempted and all further paid calls were stopped. Stage 1 already supplied enough evidence to make the model decisions below.

## Decisions

### Standard: Terra

Terra matched Luna and Sol on every explicit Standard quality check, produced the shortest aggregate output, and was faster than Sol in this sample. Luna met the four-case quality floor at a lower price, but the sample is deliberately small and Terra provides the stronger quality/cost posture for a paid $15 analysis product. Sol added no measured Standard quality benefit and cost 85% more than Terra in the observed sample.

### Deep: Terra

Terra and Sol tied on three Deep cases. Sol's only advantage was one check in the fourth case, while its observed Deep cost was about 90% higher and its mean latency about 41% higher. That is not a meaningful decision-value advantage, so Terra is the evidence-based Deep choice. Deep remains differentiated by its schema, evidence-linked blocker hierarchy, decision dynamics, and recovery strategy—not by exposing a model name or paying for an unmeasured premium.

### Auto Convert: keep Luna

Prompt 15.2 already validated Luna for the narrower extraction/normalization job. This analysis benchmark does not reveal a material extraction-quality issue and does not justify changing that separate model configuration.

## Official references and rates used

Rates checked on 2026-09-02:

- `gpt-5.6-luna`: $0.20/M input, $1.20/M output — https://developers.openai.com/api/docs/models/gpt-5.6-luna
- `gpt-5.6-terra`: $2.00/M input, $12.00/M output — https://developers.openai.com/api/docs/models/gpt-5.6-terra
- `gpt-5.6-sol`: $4.00/M input, $20.00/M output — https://developers.openai.com/api/docs/models/gpt-5.6-sol
- Pricing reference — https://developers.openai.com/api/docs/pricing

Provider prices and behavior can change. Re-run a bounded synthetic benchmark before changing production model IDs, prompts, schemas, reasoning effort, or material source/output limits.
