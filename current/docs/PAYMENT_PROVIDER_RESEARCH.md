# LostDeal AI payment-provider decision

Updated: **2026-09-02**

## Owner decision

- **Seller:** Pakistan-based individual / sole trader
- **Preferred provider:** **Paddle** (Merchant of Record)
- **Fallback provider:** **Lemon Squeezy** (Merchant of Record)
- **Paddle status:** provider approval pending

This records product direction only. Paddle has not approved LostDeal AI, and Prompt 15.1 adds no provider SDK, checkout, webhook, API secret, card storage, or paid subscription.

## Why Paddle is preferred

Paddle's official country guidance says it works with software businesses worldwide except its named unsupported countries; Pakistan is not on that list. Its verification documentation says business-identification checks are not required for individuals/sole traders, while identity verification does apply to the individual/sole trader. Country guidance is not account approval: Paddle may still review identity, domain, product, compliance, risk, and payout details.

Paddle currently advertises an all-inclusive Merchant-of-Record pay-as-you-go fee of **5% + $0.50 per checkout transaction**, including payments/billing, transaction-tax compliance, fraud/chargeback protection, and recovery capabilities. Its hosted customer portal and verified webhook-based subscription provisioning align with the planned server-authoritative billing architecture.

Official sources:

- Pricing: https://www.paddle.com/pricing
- Supported/unsupported seller countries: https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle
- Account verification: https://www.paddle.com/help/start/account-verification/what-is-account-verification
- Business identification / sole-trader distinction: https://www.paddle.com/help/start/account-verification/what-is-business-verification
- Identity verification: https://www.paddle.com/help/start/account-verification/what-is-identity-verification
- Payout schedule and methods: https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid
- Webhook provisioning: https://developer.paddle.com/build/subscriptions/provision-access-webhooks
- Customer portal: https://developer.paddle.com/concepts/sell/customer-portal

## Lemon Squeezy fallback

Lemon Squeezy remains the fallback because its official supported-country documentation explicitly lists Pakistan for bank payouts and it offers Merchant-of-Record subscription infrastructure. Store activation, identity/business review, product eligibility, and payout approval still apply; listing a country is not a guarantee that LostDeal AI will be approved.

Official sources:

- Supported countries and Pakistan listing: https://docs.lemonsqueezy.com/help/getting-started/supported-countries
- Store activation/review: https://docs.lemonsqueezy.com/help/getting-started/activate-your-store
- Identity verification: https://docs.lemonsqueezy.com/help/getting-started/verify-your-identity
- Merchant of Record: https://docs.lemonsqueezy.com/help/payments/merchant-of-record
- Customer portal: https://docs.lemonsqueezy.com/help/online-store/customer-portal
- Webhook events: https://docs.lemonsqueezy.com/help/webhooks/event-types

## Operational and legal boundary

Using a Merchant of Record reduces transaction-tax, invoicing, payment, fraud, and subscription-operating burden, but it does not remove LostDeal AI's responsibilities. The owner still needs valid identity details, provider-policy compliance, seller-income accounting/tax advice, customer support, privacy/terms/refund policies, data-protection disclosures, and product/domain approval.

## Integration gate

Do not start Paddle integration until all of the following are true:

1. Paddle approves the seller/account and LostDeal AI domain/product.
2. Approved products/prices match the $15 Starter and $45 Pro catalog; Business remains unavailable.
3. Refund, cancellation, past-due, upgrade/downgrade, tax, and support policies are approved.
4. Prompt 15.1 limits are applied and commercial tests pass.
5. Prompt 15.2 and Prompt 15.3 entitlement behavior is understood before final sellable packaging QA.

If Paddle declines or cannot provide workable Pakistan payout terms, validate Lemon Squeezy approval and terms before changing the preferred-provider decision. Never grant plan access from a checkout redirect; only verified, idempotent server-side provider events may update subscription state.
