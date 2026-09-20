# LostDeal AI demo walkthrough

Lost deals contain information a sales team is not using. LostDeal AI turns that
information into prioritized recovery opportunities and next actions.

## Before the demo

- Use a test workspace, not a customer workspace.
- Download `lostdeal-demo-hvac.csv` from **Upload Deals**.
- The file contains 20 clearly labeled synthetic HVAC opportunities.
- Analyze only the seven suggested records below. Importing and browsing the CSV
  use no OpenAI calls; only an explicit **Analyze** action does.

| Deal | Demonstrates |
| --- | --- |
| `DEMO-HVAC-1001` | Financing blocker with strong intent |
| `DEMO-HVAC-1002` | Customer-requested later timing |
| `DEMO-HVAC-1003` | Decision-maker approval pending |
| `DEMO-HVAC-1004` | Missed sales follow-up |
| `DEMO-HVAC-1005` | Price and scope comparison |
| `DEMO-HVAC-1006` | Competitor completed the work; likely No Action |
| `DEMO-HVAC-1019` | Weak information and appropriately low confidence |

## Prospect walkthrough

1. Start at **Recovery Overview**. Explain that lost opportunities are normally
   buried in CRM notes and call transcripts.
2. Open **Upload Deals** and show the two download choices: the 10-row import
   sample and the 20-row HVAC demo dataset.
3. Upload `lostdeal-demo-hvac.csv`, keep the automatic canonical mapping, and
   confirm **20 Total / 20 Valid / 0 Invalid** before importing.
4. Open **Lost Deals** to show that synthetic records use the same search,
   filters, analysis, and scoring workflow as ordinary customer data.
5. Open one selected pending deal and explicitly run **Analyze**.
6. Under **Understand**, show Lost Reason, Buying Intent, and Analysis Confidence.
7. Under **Verify**, compare Grounded Evidence with the original Sales Notes or
   Transcript. Explain that unsupported evidence is not displayed as grounded.
8. Under **Prioritize**, calculate the deterministic Recovery Score and open its
   50% Buying Intent, 30% Lost Reason Recoverability, and 20% Recency breakdown.
9. Under **Act**, show Recommended Next Action and the review-before-sending
   follow-up draft. LostDeal AI does not contact the customer automatically.
10. Open `DEMO-HVAC-1006` to demonstrate that a completed competitor installation
    should produce a low-pursuit or No Action result rather than blind outreach.
11. Open `DEMO-HVAC-1019` to show cautious behavior when the source is weak.
12. Return to **Lost Deals**, sort Recovery Score high to low, and filter by
    priority.
13. Return to **Recovery Overview** and show Analysis Coverage, Scoring Coverage,
    Top Recovery Opportunities, Priority Distribution, and Why Deals Are Being
    Lost.
14. Close with the five product pillars: **Understand** why a deal was lost,
    **Prioritize** what deserves attention, **Act** on a clear next step,
    **Verify** the source evidence, and **Trust** the score breakdown.
15. State the boundary clearly: Recovery Score is a prioritization indicator,
    not a probability, forecast, or guarantee of recovered revenue.

## Dataset maintenance

The committed CSV is dated relative to the 2026-08-30 demo release. Regenerate
the same 20 scenario identities with fresh relative dates when needed:

```bash
node scripts/generate-demo-data.mjs YYYY-MM-DD
```

The generator is deterministic for a supplied date and uses no OpenAI,
Supabase, network access, or private data.
