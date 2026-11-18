# Stripe integration testing

Start with the [payment simulator](sandbox-payments.md). A Stripe account is
not needed to run the starter kit's complete sandbox purchase workflow.

Stripe is an optional, separately approved integration. Ask your Rainwalk
contact to agree the provider/account configuration, test-mode references and
certification process before using it. New Partner API v1 Stripe operations
are denied without explicit Rainwalk approval, including in sandbox.

The SDK's `createStripePaymentReference` accepts approved opaque account,
`cus_` customer and `pm_` payment-method references. Collection/tokenization
belongs to your approved Stripe integration. Never submit card/bank details,
Stripe client secrets or secret API keys to Rainwalk reference registration.
The reference app's Stripe form accepts already-created test references; it
does not create a Stripe account or collect/tokenize cards.

Before production certification, verify account/customer ownership, reference
verification, successful/declined payments, any required authentication,
pending reconciliation, unchanged idempotent retries after ambiguous outcomes,
and authoritative policy retrieval. Reference approval, payment success,
policy issuance and insurance coverage are distinct states.

Use synthetic information and approved test-mode references only. Sandbox
simulation does not establish any real Stripe behavior. Production API access
and real payment processing remain separate approval steps.
