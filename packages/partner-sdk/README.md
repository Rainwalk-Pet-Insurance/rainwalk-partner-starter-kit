# Rainwalk Partner SDK

Server-side TypeScript/JavaScript client for the quote-to-policy purchase flow of Partner API
v1. Requires Node.js 24+. Includes ESM, Node 24 CommonJS interoperability and
TypeScript declarations. No runtime dependencies. Not yet published to npm. Build it from this repository.

Start with the [runnable partner quickstart](../../examples/partner-quickstart/README.md).
From the repository root, run `npm ci` and `npm run build:sdk`.

```ts
import { RainwalkClient, RainwalkApiError, type QuoteRequest } from '@rainwalk/partner-sdk';

const client = new RainwalkClient({
  apiKey: process.env.RAINWALK_API_KEY!,
  environment: 'sandbox', // production requires an explicit choice and approved access
  timeoutMs: 15_000,
});

const options = await client.getQuoteInputOptions();
if (options.status === 200) console.log(options.body.data.coverage_preferences);
const breeds = await client.getBreedLists({ postal_code: '78701' });
if (breeds.status === 200) console.log(breeds.body.data.dog);

// Build input using the choices and canonical breeds returned above.
async function submit(input: QuoteRequest, persistedRequestKey: string) {
  try {
    const result = await client.createQuote(input, { idempotencyKey: persistedRequestKey });
    console.log(result.body.data.id, result.metadata.requestId);
    return client.getQuote(result.body.data.id);
  } catch (error) {
    if (error instanceof RainwalkApiError) {
      console.error(error.status, error.code, error.requestId, error.metadata.retryAfter);
    }
    throw error;
  }
}
```

## Supported methods

- `getStatus(options?)`
- `getQuoteInputOptions({ ifNoneMatch?, signal?, correlationId? }?)`
- `getBreedLists({ state } | { postal_code }, options?)`
- `createQuote(body, { idempotencyKey, signal?, correlationId? })`
- `getQuote(quoteId, options?)`
- `selectPlan(quoteId, body, { idempotencyKey, signal?, correlationId? })`
- `registerPaymentMethodReference(body, { idempotencyKey, signal?, correlationId? })`
- `getPaymentMethod(paymentMethodId, options?)`
- `listPaymentMethods({ limit?, cursor?, signal?, correlationId? }?)`
- `createBind(body, { idempotencyKey, signal?, correlationId? })`
- `getBind(bindId, options?)`
- `getPolicy(policyId, options?)`
- `listPolicies({ limit?, cursor?, signal?, correlationId? }?)`

Responses contain `{ status, body, metadata }`; `body` preserves the API envelope
and snake_case field names. Metadata includes request/correlation IDs, ETag,
rate-limit headers, Retry-After and replay state. Money remains a decimal string;
timestamps and calendar dates remain strings. Unknown response fields are
preserved. Types are compile-time contracts, not runtime response validation.

Conditional methods return a discriminated `200`/`304` union. A `304` has no body:
reuse your cached previous body. The client maintains no cache. Without a supplied
ETag, methods request fresh data.

`RainwalkApiError` exposes HTTP status, API code/message, nested or list-shaped
validation details and response metadata. `RainwalkTransportError.kind` is
`timeout`, `aborted`, `network` or `invalid_response`; cancellation and timeout
can leave a mutation outcome unknown. The client does not automatically retry.
Retain a logical mutation's key and payload before calling, and reuse both for
recovery within the API's 24-hour window. Honor Retry-After for rate limits.

Never put an API key in a browser/mobile app or log it. Browser construction is
rejected as a guardrail; secrets must still be excluded from bundles at build
time. The reference app uses an explicit server-only module boundary.

For controlled local tests, the client accepts `fetch` and `baseUrl` overrides.
Base URLs require HTTPS except loopback HTTP, and cannot contain credentials,
queries or fragments. A custom endpoint receives your credential: use overrides
only for a trusted endpoint. Redirects are rejected to avoid forwarding keys.

## Select a plan

Use an `offer_id` and billing frequency returned in the quote's `offers[]`.
Plan selection requires the additional `partner.quote.select_plan` capability.
Use a different logical request key from quote creation:

```ts
const selection = await client.selectPlan(quoteId, {
  offer_id: offerId,
  billing_frequency: 'monthly', // must be included in that offer's billing_options
}, { idempotencyKey: persistedSelectionKey });
console.log(selection.body.data.id, selection.body.data.price);
```

Keep the quote ID, offer ID, payload and selection key together. Retrying the
same selection reuses the same key and byte-equivalent body. An existing
selection is immutable: a different frequency for the same offer returns
`409 selection_conflict`. The original frequency can recover an existing
selection even after offer expiration; a new expired-offer selection returns
`422 offer_expired`. Retrying a terminal failure does not create a new offer.
Use the returned price snapshot as authoritative. Selection does not collect
payment or issue a policy.

## Stripe reference registration and purchase

For first integration testing without a Stripe account, authenticated sandbox
partners with the required v1 grants can use the simulator by default:

```ts
import { createSandboxPaymentReference } from '@rainwalk/partner-sdk';

const method = await client.registerPaymentMethodReference(
  createSandboxPaymentReference('success'), // decline | pending | rejected
  { idempotencyKey: simulatorRegistrationKey },
);
```

The API still enforces authentication and partner grants/rollout. No simulator
opt-in is required. Production rejects the simulator. Responses carry `simulated: true`,
policies remain `test_policy`, and no real funds or insurance coverage result.
These references use `provider: sandbox_simulator`; they are not fake Stripe
tokens. Keep them out of the Stripe collector. See
[simulator operations](../../docs/sandbox-payments.md)
for exact scenarios and Stripe approval.

No Stripe SDK, Stripe secret key or card details belong in this package. Explicit Rainwalk approval is required for
new v1 Stripe operations in every environment. The approved provider integration
collects and authenticates the method first.
`createStripePaymentReference` maps those opaque references to the API contract;
the purchase methods remain separate from that provider-specific collector.
New provider collectors require corresponding API approval/schema support.

```ts
import { createStripePaymentReference } from '@rainwalk/partner-sdk';

const reference = createStripePaymentReference({
  accountReference: approvedAccountReference,
  customerReference: stripeCustomerId,
  paymentMethodReference: attachedStripePaymentMethodId,
  type: 'card', // or bank_account when approved for your integration
});
const method = await client.registerPaymentMethodReference(reference, {
  idempotencyKey: registrationRequestKey,
});
// GET until approved or rejected. Pending/rejected references must not be bound.
const verified = await client.getPaymentMethod(method.body.data.id);
if (verified.body.data.status !== 'approved') throw new Error('Reference is not approved.');

// Retain this entire body, including the recorded consent timestamp, and the
// key before sending. All identifiers come from the current purchase journey.
const bind = await client.createBind({
  quote_id: quoteId,
  plan_selection_id: selection.body.data.id,
  payment_method_id: verified.body.data.id,
  consent: recordedPolicyholderConsent,
}, { idempotencyKey: bindingRequestKey });
const outcome = await client.getBind(bind.body.data.id);
if (outcome.body.data.status === 'bound' &&
    outcome.body.data.payment.attempt_status === 'succeeded' && outcome.body.data.policy) {
  const policy = await client.getPolicy(outcome.body.data.policy.id);
  console.log(policy.body.data.policy_number, policy.body.data.status, policy.body.data.effective_at);
}
```

Reference creation normally returns 201/pending_verification; binding currently
returns 202/processing. Poll resource GETs with backoff, respecting Retry-After.
`payment.status` means reference approval; `payment.attempt_status` is the charge
outcome. `processing` is not final. Never infer payment success from approval or
an existing policy ID. Check policy status and effective date separately; issue
and effective values are calendar dates. Terminal failures remain failures even
when their payment reference is still approved.

The SDK never automatically replays a mutation or changes its key. The example
keeps recovery state in browser memory for v1. Refresh/restart recovery and
persistent storage are deferred. Preserve unknown-outcome requests within that
page session; do not submit a replacement purchase while an outcome is unknown.
Webhooks are not implemented in this SDK milestone.

## Maintain and package

The public type-generation snapshot is
[`partner-api-v1.openapi.yaml`](../../docs/partner-api-v1.openapi.yaml).
Generated types describe the entire contract; only the methods above are
implemented. Do not edit `src/schema.d.ts` manually.

```sh
# From repository root
npm run generate:sdk
npm run check:partner

# Produce a local tarball; does not publish
npm pack -w @rainwalk/partner-sdk --pack-destination /tmp
```

An external project can install the resulting tarball with
`npm install /tmp/rainwalk-partner-sdk-0.1.0.tgz`. Source releases use the MIT
license and coordinated SDK/app versions. npm account/scope ownership and registry
publication are deferred; see [releasing](../../RELEASING.md).
