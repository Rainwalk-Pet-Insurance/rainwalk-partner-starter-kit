# Sandbox payment simulator

Authenticated sandbox partners with normal API v1 rollout access and the
required quote/payment/policy capabilities can use the simulator by default.
No Stripe account or separate simulator opt-in is needed. Production rejects
simulation. Obtain a key from the sandbox partner portal, not the production
portal; these accounts and keys are separate.

Use `createSandboxPaymentReference(scenario)` in the SDK, or keep **Sandbox
simulator** selected in the reference app. It registers a payment reference
through `POST /partner/v1/payment-methods`:

```json
{
  "provider": "sandbox_simulator",
  "provider_account_reference": "rw_sim_account",
  "provider_customer_reference": "rw_sim_customer",
  "provider_payment_method_reference": "rw_sim_success",
  "type": "card"
}
```

| Scenario | Reference registration | Binding outcome |
| --- | --- | --- |
| `success` | approved | succeeded / bound |
| `decline` | approved | failed / payment_failed, with payment_method_declined |
| `pending` | approved | processing, then succeeded / bound |
| `rejected` | rejected | binding is refused before a purchase attempt |

Use a separate quote/selection to test another completed purchase. Record
synthetic consent in the local app for binding; never submit real customer data
for this exercise. The API's background workers advance payment outcomes;
reading a bind does not execute a payment. Pending reconciliation can take a
few minutes. Honor Retry-After and retain the original request keys/payloads.

Simulator responses include `simulated: true`. Successful policies have `SIM-`
numbers, status `test_policy`, and inactive `sandbox_simulator` billing. No real
funds, insurance coverage, recurring billing or customer emails are produced.
Reference approval does not itself mean a payment succeeded.

Do not refresh the local app while an outcome is uncertain: it retains retry
context only in browser memory. Check the existing bind rather than starting a
replacement purchase. Persistent restart recovery and webhook handling are
outside this starter kit.

Stripe processing needs separate explicit Rainwalk approval, including in
sandbox. There is no automatic fallback from Stripe to simulation. The
simulator verifies Rainwalk's workflow; it does not certify Stripe/Connect/3DS.
See [Stripe testing](stripe-testing.md) before integrating a real processor.
