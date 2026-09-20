# LostDeal AI V1 unit economics

Model date: **2026-09-02**
Decision basis: owner-approved **$15 Starter** and **$45 Pro** monthly prices with the Prompt 15.3 allowances and the bounded synthetic analysis benchmark. These are planning ranges, not accounting forecasts or provider quotes.

## Assumptions

- Four successful synthetic Standard analyses on the selected `gpt-5.6-terra` model averaged 1,121 input and 238 output tokens, **$0.005092 each**; the highest observed case was **$0.008052**. Until production p50/p95 telemetry exists, budget **$0.005–$0.009 per successful Standard Analysis**.
- Four successful synthetic Deep analyses on the selected `gpt-5.6-terra` model averaged 2,589 input and 906 output tokens, **$0.016047 each**; the highest observed case was **$0.019904**. Budget **$0.016–$0.020 per successful Deep Analysis** before production telemetry.
- Budget **$0.001–$0.010 per successful AI Smart Mapping request** pending dedicated production telemetry.
- Auto Convert's deterministic benchmark uses 1,800 source characters per row and 60–180 estimated output tokens per row. At the current `gpt-5.6-luna` standard rates of $0.20/M input and $1.20/M output, measured planning ranges are **$0.02–$0.03 for 100 rows**, **$0.09–$0.16 for 500**, and **$0.27–$0.48 for 1,500**. Its dedicated model is required in production; a missing analysis-model override cannot silently promote Standard or Deep to Sol.
- Recovery Score, deterministic/manual mapping, CSV normalization/download, dashboards, Deal Intelligence page loads, and themes make zero OpenAI calls.
- Paddle's current public pay-as-you-go Merchant-of-Record price is **5% + $0.50 per checkout transaction**. That implies $1.25 on a $15 transaction and $2.75 on a $45 transaction. Refund, dispute, currency, payout, and negotiated fees may differ and require approval/onboarding confirmation. Source: https://www.paddle.com/pricing
- Hosting/database/monitoring is modeled as a broad usage-sensitive range. Imported-deal storage and query activity are represented there rather than given fake per-row precision.
- Human support, acquisition, fixed software, taxes on seller income, refunds, and chargebacks are excluded and must be monitored separately.

## Light, normal, and heavy usage

| Plan | Scenario | Analyses | AI mappings | Auto Convert rows | Estimated AI | Hosting/DB | Paddle fee | Approx. variable cost | Approx. gross margin |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Starter $15 | Light | 5 Standard | 1 | 0 | $0.03–$0.06 | $1–$2 | $1.25 | $2.28–$3.31 | 78%–85% |
| Starter $15 | Normal | 15 Standard | 2 | 0 | $0.08–$0.16 | $2–$4 | $1.25 | $3.33–$5.41 | 64%–78% |
| Starter $15 | Heavy | 30 Standard | 3 | 0 | $0.15–$0.30 | $4–$8 | $1.25 | $5.40–$9.55 | 36%–64% |
| Pro $45 | Light | 25 Deep | 3 | 100 | $0.42–$0.56 | $2–$4 | $2.75 | $5.17–$7.31 | 84%–89% |
| Pro $45 | Normal | 125 Deep | 15 | 750 | $2.16–$2.89 | $4–$8 | $2.75 | $8.91–$13.64 | 70%–80% |
| Pro $45 | Heavy | 250 Deep | 30 | 1,500 | $4.30–$5.78 | $6–$12 | $2.75 | $13.05–$20.53 | 54%–71% |

Margin is `(price - modeled variable cost) / price`, rounded. The table deliberately uses ranges rather than implying exact provider or infrastructure cost.

## Safety assessment

Both approved plans remain contribution-positive in the modeled legitimate heavy-use case. At the observed Terra Deep average, 250 analyses cost about **$4.01**; using the highest observed Terra case for all 250 is about **$4.98**. Adding the 1,500-row Luna Auto Convert range, Paddle fee, and $6–$12 infrastructure allowance leaves an estimated **54%–71%** Pro gross-margin range. The comparable observed Sol Deep average would be about **$7.63 for 250** before Auto Convert and other costs, with no meaningful Stage 1 quality advantage. Terra is therefore both the quality-supported and economically safer choice.

Starter's 30 Standard analyses are about **$0.15 at the observed Terra average** and **$0.24 if every run matched the highest observed case**. Its heavy scenario is still thinner once infrastructure and payment fees are included, but it remains contribution-positive under the approved hard limit. Neither plan requires a quality downgrade or an owner pricing/allowance decision at this checkpoint.

Prompt 15.3.1 rechecked the encoded plans, limits, selected models, and deterministic cost arithmetic on 2026-09-05. None changed, no paid benchmark was repeated, and the durable finalizer still commits exactly one `AI_ANALYSES` unit per successful explicit Standard or Deep operation. The Starter $15 and Pro $45 safety conclusions above therefore remain unchanged.

Before enabling `ENFORCED` billing or checkout:

1. Record p50/p95 input/output tokens and actual provider cost per successful analysis and mapping.
2. Record storage, database, worker, and support cost per active organization.
3. Confirm Paddle's approved commercial terms and Pakistan payout method/fees.
4. Model refunds, disputes, failed payments, currency conversion, and taxes.
5. Record Auto Convert input/output tokens, provider failures, rows per batch, and actual cost per completed row; re-run the heavy case before enabling paid Pro.
6. Re-run the benchmark and unit model if prompts, schemas, reasoning effort, model IDs, limits, or provider rates materially change.

Pricing references checked on 2026-09-02: https://developers.openai.com/api/docs/pricing, https://developers.openai.com/api/docs/models/gpt-5.6-luna, https://developers.openai.com/api/docs/models/gpt-5.6-terra, and https://developers.openai.com/api/docs/models/gpt-5.6-sol. Full analysis evidence is in `docs/ANALYSIS_MODEL_BENCHMARK.md`. Provider prices can change; benchmark ranges are not a quote or guarantee.

Business has no price or active commercial allowance, so no Business unit-economics claim is made.
