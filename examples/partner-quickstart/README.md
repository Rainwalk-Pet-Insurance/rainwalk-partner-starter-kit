# Sandbox quote-to-policy quickstart

Run a frontend and partner backend together, using the TypeScript SDK to create
and retrieve a real Rainwalk Partner API v1 sandbox quote, select an offer,
register a simulated payment reference and retrieve the bind/policy outcome. The goal is a first
quote within 30 minutes **after working sandbox access is supplied**.

## Before you start

- Use Node.js 24 and npm (the root lockfile uses npm workspaces).
- Sandbox organization owners can create a sandbox API key in the
  [sandbox partner portal](https://dev.partners.rainwalk.io/portal/organization/api-keys/)
  under **Organization → API keys**. Sandbox accounts are separate from production;
  keys created in the production portal will not authenticate with this app. Other developers should ask their owner to share
  a key through an approved secure channel. Do not send keys in email, tickets, screenshots or chat.
- Ask your Rainwalk contact to confirm sandbox partner access, the
  `rollout.partner_api_v1` feature, and `partner.quote.read` /
  `partner.quote.create` capabilities. Plan selection additionally requires
  `partner.quote.select_plan`. Purchase steps additionally need
  `partner.payment_method.create`, `partner.payment_method.read`,
  `partner.policy.bind` and `partner.policy.read`. Reading the public reference does not
  grant API access.
- Use synthetic customer information. No payment-provider setup is needed for
  the simulator workflow. Production activation is a separate process. Stripe purchase verification needs
  an approved test-mode integration; see the purchase prerequisites below.

## Run the example

From the repository root:

```sh
npm ci
cp examples/partner-quickstart/.env.example examples/partner-quickstart/.env.local
```

Edit `examples/partner-quickstart/.env.local` locally and replace the placeholder
with your sandbox key. This file is ignored by Git. Keep the variable named
`RAINWALK_API_KEY`; never give it a `NEXT_PUBLIC_` prefix.

```sh
npm run dev:partner
```

Open **http://127.0.0.1:3000** (or the port printed by Next.js if 3000 is occupied).
The app connects to `https://dev.api.rainwalk.io/partner/v1` from its server.

1. Wait for **Sandbox connected · form choices loaded**.
2. Use the illustrative ZIP `78701` and click **Load breeds**. Availability is
   checked by the API; ask your contact for another supported location if needed.
3. Choose a canonical breed. The prefilled customer, pet and Austin address are
   synthetic; if you change ZIP, update the city/address to match. The state is
   resolved from the breed lookup. Select coverage from the API-provided choices.
4. Click **Get sandbox quote**. The right panel displays returned offers,
   decimal-string premiums, coverage terms, expiration and request ID.
5. Click **Retrieve saved quote** to fetch the same resource again.
6. On the offer, choose a **Billing frequency** from its returned billing options
   and click **Select this plan**. The app shows the selection ID, billing
   frequency, authoritative selected price and request ID.
7. The selection is immutable. Retrieving the quote again preserves its selected
   state in the current page; **Start a new quote** clears that state.

The app creates a request key per distinct quote submission. Retry unchanged
details after a temporary error to keep the same key and payload. Editing details
or choosing **Start a new quote** starts a different logical submission. Keys are
kept only in this page's memory and the API retains them for 24 hours; reloading
the page loses the local retry context. A production integration can add persistent recovery later; v1 deliberately keeps this state
in page memory. Do not refresh while a purchase outcome is unknown.

## How it fits together

```text
Browser form → local Next.js API routes → server SDK → Rainwalk sandbox
```

Browser code imports SDK types and the pure Stripe reference mapper; it never
constructs an authenticated client. `lib/rainwalk.ts` is marked `server-only` and
constructs the authenticated client. `lib/server.ts` accepts only the supported quote/purchase
operations; it is not a general API proxy. Responses are not cached.

This is a local learning app. Both start commands bind to loopback; the routes
reject non-loopback hosts and cross-origin requests. There is no user login or
hosted deployment configuration. Before adapting it to a public partner service,
add your own authentication, customer authorization, request validation, rate
limits and durable idempotency storage. Keep Rainwalk keys server-side.

The quote form gets constraints from `/quote-inputs` and canonical breeds from
`/breed-lists`. These helpers do not guarantee eligibility. Returned offers are
authoritative; the app does not calculate insurance prices. All listed offers
retain their API expiration; selecting an offer saves a plan selection but does not bind it.

## Selection retries and recovery

Each offer has its own selection request key for each billing frequency. Quote
creation and selection never share a request key. After a timeout or temporary
failure, retry the same offer/frequency; switching away and back preserves the
original recovery key within this page session. A successful selection shows the
server's returned price snapshot and locks its frequency in the UI.

An offer can have only one immutable selection. Changing frequency after an
existing selection returns `selection_conflict`; retry its original frequency
to recover it. Existing selections can be recovered after offer expiry, but an
expired offer cannot create a new selection. The app leaves recovery available
and lets the API enforce expiration. Keys and results are kept in page memory;
v1 keeps them only in memory before making a request. A page reload
loses this UI state. Use the same frequency to recover an existing selection.

## Complete a sandbox purchase

### Start without Stripe: sandbox simulator

The simulator is available by default to active, authenticated sandbox partners.
Your normal quote/payment/policy capability grants and v1 rollout access are
still required; there are no simulator opt-in flags. **Payment integration**
already defaults to **Sandbox simulator**. Choose a scenario:

- **Successful payment:** approved reference, then bound/succeeded.
- **Declined payment:** approved reference, then payment_failed/failed.
- **Pending, then successful:** approved reference, processing, then succeeded
  through the normal reconciliation workers.
- **Rejected payment reference:** rejected immediately; binding stays unavailable.

Click **Register simulated reference**, then follow the consent/binding/status
steps below. Simulator results are marked; the policy is a test record only,
with no real funds, insurance coverage, customer email, documents or recurring
billing. A pending scenario needs the normal sandbox workers to progress;
refreshing status never advances the simulation itself.

No separate Stripe account, keys or test references are needed for these four
scenarios. Real Stripe certification remains a separate integration step.

### Approved Stripe integration

Stripe is an explicit alternative in the payment integration dropdown and
requires separate Rainwalk approval, approved provider/account configuration,
and normal API capabilities. This applies to sandbox and production. Ask your
Rainwalk contact to arrange access; the app cannot approve Stripe by itself.

Stripe collection is deliberately separate from the purchase workflow.
`app/stripe-reference-form.tsx` collects existing references and emits the API
request contract through `createStripePaymentReference`; registration, binding
and status handling are in `app/checkout.tsx`. A future approved integration can
replace the collector without rewriting purchase state handling.

You do not need a separate Stripe account merely to run the quote/selection
steps or automated tests. For an actual Stripe-backed sandbox purchase, Rainwalk
must confirm a test-mode platform/Connect configuration, the approved account
reference and attached `cus_…` / `pm_…` references. The account reference is an
onboarding value, not automatically your Stripe account ID. Do not invent these
values, submit test-card numbers to Rainwalk, or use production references as a
readiness probe. No Stripe secret key is configured in this app. It does not
create SetupIntents, collect cards, or perform 3DS; complete those steps in the
approved provider integration before registering its references.

1. Create a quote and select an offer. Select **Use this selected plan** if you
   want to return to a selection you already made in this page.
2. In **Complete sandbox purchase**, enter the approved account, Stripe customer,
   attached PaymentMethod reference and method type. Click **Register payment reference**.
3. Wait for **approved**. The app polls GET status with exponential backoff,
   honors Retry-After and pauses after ten reads. You can pause/resume automatic
   checks or use **Check reference status**. Rejected references cannot be bound;
   use another approved reference after addressing the rejection.
4. Enter the terms version agreed during onboarding and confirm that the
   policyholder's consent has been recorded. In isolated tests this is synthetic
   consent; actual integrations must supply the actual consent record.
5. Click **Request sandbox binding**. The exact body, consent timestamp and
   request key are frozen before sending. A timeout keeps the original request
   available through **Retry original bind request**. Quote editing and starting
   another purchase remain locked while the outcome is uncertain.
6. Check bind status until a terminal outcome. Polling never automatically
   replays a registration or binding POST. **approved** is reference approval;
   **succeeded** is the charge result. Processing and a pending policy ID do not
   establish successful payment or active coverage.
7. Once a bind is bound with a succeeded charge, the app retrieves the policy.
   **Retrieve policy** also supports an explicit retry if that read fails. Review
   policy number, status, issue/effective dates, coverage and billing summary.
   A policy can be issued before its effective date.

Validation/not-found/payment-method-not-approved responses that the API records
before any bind is created allow correction and a new request. Transport errors,
authorization changes and conflicts retain the original recovery context; a
conflict may indicate an existing purchase. No browser refresh/restart recovery
is provided in v1. Webhooks and persistent recovery storage are deferred.

## Troubleshooting

| Result | Action |
| --- | --- |
| `configuration_error` | Set the server-only sandbox key and restart the app. |
| `401` / `invalid_api_key` | Check environment, expiration and revocation with your onboarding contact. |
| `403` | Ask your contact to check rollout access and required quote capabilities. Selection needs `partner.quote.select_plan`. |
| `400` / `422` | Read the displayed field details. Check ZIP/state/address, birth date and canonical breed. |
| Uncovered location | Use an approved supported test location; an empty breed list is not a service failure. |
| `429` | Wait for the displayed `Retry-After` seconds before retrying unchanged details. |
| Timeout / network / `5xx` | Outcome may be unknown. Retry unchanged details with the same key; do not create a new logical request just to retry. |
| `409 selection_conflict` | Recover the existing selection using its original billing frequency. |
| `422 offer_expired` | A new selection needs a new unexpired offer. Existing selection recovery uses the original frequency. |
| `409 idempotency_key_reused` | The key was already used with different input. Restore the original payload for recovery; use a new key only for an intentionally new quote. |

For support, share environment, endpoint, UTC time and request ID—not API keys or
customer payloads. Reference: [Partner API v1](https://api.rainwalk.io/api/schema/redoc/partner/v1).

## Verify locally

From the repository root, without any credentials:

```sh
npm run check:partner
```

This checks generated types, SDK behavior, installation of the packed package
from JavaScript/CommonJS/TypeScript, app routes, form interactions, TypeScript
and the Next.js production build. Routine tests use synthetic data and mocked
HTTP, with no Rainwalk/payment/email calls or Sentry integration. The build
does not make API requests or require a key.

To run a built app locally:

```sh
npm run build:sdk
npm run build -w @rainwalk/partner-quickstart
npm run start -w @rainwalk/partner-quickstart
```

Live sandbox verification is separate: follow the UI steps with an approved key,
confirm the returned quote ID and retrieve it. Have a developer unfamiliar with
the implementation follow this guide; record time to first quote, request IDs
and setup friction without recording credentials or customer information.

## Verification limits and later work

Automated tests simulate pending/approved/rejected methods, processing and
successful/failed binds, unknown outcomes, duplicate clicks, unchanged mutation
replays, rate-limit backoff and policy-read recovery. They do not establish a real
Stripe test-mode charge, 3DS challenge, Connect routing or live worker delivery.
Complete the [Stripe certification](../../docs/stripe-testing.md)
with approved test-mode references before declaring a payment integration certified.

Persistent refresh/restart recovery and webhook support are deferred. Registry
publication and a human developer onboarding pilot remain separate release work;
the packed package consumer check verifies installation from a clean temporary
project without repository module resolution.
