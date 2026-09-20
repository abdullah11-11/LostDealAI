# Prompt 15.4 — Premium Marketing Experience

Baseline: release 37, `efd9e362e0373747f8daf260be73d4dfe2558c89`.
Prompt 15.3.x remains closed. Prompt 16 is not started. Owner marketing approval is required before Prompt 16.

## Positioning and approved copy

Positioning: **Lost deals in. Best recovery opportunities out.**

Primary headline: **Your CRM is full of deals you already paid to acquire.**

Secondary headline: **Find the ones worth another shot.**

Supporting copy: Upload your closed-lost sales data. LostDeal AI cleans messy exports, explains why deals were lost, ranks recovery opportunities, and gives your team the next move — grounded in the evidence you already have.

The public story emphasizes CRM independence, supported CSV exports, evidence grounding, deterministic prioritization, and user-controlled outreach. There are no customer logos, testimonials, adoption metrics, guaranteed recovery claims, certifications, or invented integrations. Product examples use isolated synthetic records only.

## Architecture

- `/`: homepage, full product story, four-step workflow, proof, industries, personas, pricing, trust, FAQ and final CTA.
- `/product`: expanded import, Auto Convert, Standard, Recovery Score, Deep and evidence workflow.
- `/pricing`: Starter/Pro cards, feature comparison, allowance explanations and FAQ.
- Shared components live in `components/marketing`; static copy and the public plan projection live in `lib/marketing`.
- Marketing has no database client, provider runner, analysis route, server secret, or mutation import.
- Authenticated routes, auth flow, proxy, application components, entitlements, scoring, usage, AI models and migrations are unchanged.
- Marketing uses one controlled light appearance with dark feature surfaces. Its classes and logo presentation are scoped to `.marketing-surface`; app appearance settings remain intact.

## Design

The existing Geist fonts and LostDeal assets are reused. Marketing tokens in `app/globals.css` preserve ink `#182230`, ivory `#fffcf7`, orange `#f97316`, cream `#fff7e8`, white, and the existing neutral border. Contrast-safe orange and slate text and restrained green completion states supplement those values.

The main visual is a composed static export → Auto Convert → score → Deep strategy interface. No raster product screenshots, stock art, animation packages, or new dependencies were added. Short CSS entry transitions respect the existing reduced-motion rule.

## Plans and CTA behavior

Prices and allowances are read from the unchanged public `PLAN_CATALOG`.

Starter: $15/month; 250 imported deals, 30 AI analyses, 3 AI mapping requests. Standard, Recovery Score, Smart Import and evidence-grounded recommendations. No Deep or Auto Convert included.

Pro: $45/month; 1,500 imported deals, 250 AI analyses, 30 AI mapping requests, 1,500 Auto Convert rows. Everything in Starter plus AI Auto Convert and Deep Recovery Analysis.

Starter positioning: For small teams that want to understand and prioritize lost opportunities.

Pro positioning: For teams with messy exports or larger lost-deal pipelines that want deeper recovery intelligence.

Primary CTA: **See LostDeal in Action** → `/product`. Secondary CTA: **View Pricing** → `/pricing`. Sign In → existing `/login`. Pricing **Create a workspace** → existing `/signup`; this does not select a plan, change entitlements, create a subscription, or collect payment.

Billing stays SHADOW. The cards explicitly explain that checkout is inactive. Pro commercial activation remains pending verified billing. `PlanCta` is the single plan-aware replacement point for Prompt 16; it receives the public plan and can later accept an authorized checkout action/loading/result adapter. No billing behavior has been implemented.

## Verification and limits

- Targeted marketing tests: 11/11.
- Full TypeScript tests: 561/561, preserving all 550 baseline tests.
- Rendered production tests: 2/2; homepage metadata/content, all three marketing routes, zero external calls during marketing render, and four protected app redirects.
- Existing UI tests: 13/13. Lint, typecheck, production build and artifact checks pass.
- Production dependency audit: 0 critical/high/moderate/low. No package changes.
- Source, client, public assets and sensitive path scans pass.
- Protected business/auth/security/database source is byte-identical to baseline. No migration. No provider calls.

Visual QA limitation: supervised preview starts, but the supported cloud browser returns `net::ERR_BLOCKED_BY_CLIENT` for the required preview address. Desktop/tablet/mobile browser inspection and mobile interaction validation are therefore NOT marked PASS. Responsive grids, disclosure navigation, focus styling, native FAQ and reduced motion are implemented and statically checked. Actual-device visual review remains required; no alternative browser-control path or access bypass was used.

Benchmark: Rizer was used only as the supplied quality benchmark. Search found its official positioning at https://rizer.io/ and support material at https://support.rizer.io/, but the main page could not be opened by the research tool. No claim of a fresh pixel-for-pixel comparison or objective superiority is made. LostDeal's independently designed priorities are immediate product explanation, visible workflow, clear two-plan pricing, CRM independence, and evidence grounding.

Owner review: inspect `/`, `/product`, `/pricing` at desktop, tablet and phone widths; verify menu and FAQ interactions. Prompt 16: GO AFTER OWNER MARKETING APPROVAL. Commercial launch: NO.
