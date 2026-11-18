import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RainwalkClient, RainwalkApiError, RainwalkTransportError, createStripePaymentReference, createSandboxPaymentReference, PaymentReferenceValidationError } from '../dist/index.js';

const apiKey = 'synthetic-server-key';
const quoteId = '11111111-1111-4111-8111-111111111111';
const input = { policyholder: { email: 'ava@example.test' }, pet: { name: 'Mochi' } };
function client(fetch, options = {}) { return new RainwalkClient({ apiKey, environment: 'sandbox', fetch, ...options }); }

test('sends v1 authentication and preserves mutation body/key without automatic retries', async () => {
  const requests = [];
  const sdk = client(async (url, init) => {
    requests.push({ url, init });
    return Response.json({ data: { id: quoteId, extra_future_field: true } }, { status: 201, headers: { 'X-Request-Id': 'req_test', 'Idempotent-Replay': 'true' } });
  });
  const options = { idempotencyKey: 'same-logical-request', correlationId: 'trace_test' };
  assert.ok(!JSON.stringify(sdk).includes(apiKey));
  const result = await sdk.createQuote(input, options);
  await sdk.createQuote(input, options);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://dev.api.rainwalk.io/partner/v1/quotes');
  assert.equal(requests[0].init.headers.get('authorization'), `Api-Key ${apiKey}`);
  assert.equal(requests[0].init.headers.get('x-correlation-id'), 'trace_test');
  assert.equal(requests[0].init.headers.get('idempotency-key'), options.idempotencyKey);
  assert.equal(requests[0].init.headers.get('content-type'), 'application/json');
  assert.equal(requests[0].init.body, JSON.stringify(input));
  assert.equal(requests[1].init.body, requests[0].init.body);
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal(result.body.data.extra_future_field, true);
  assert.equal(result.metadata.requestId, 'req_test');
  assert.equal(result.metadata.idempotentReplay, true);
});

test('GET routes and query strings are scoped correctly; keys are never placed in URLs', async () => {
  const urls = [];
  const sdk = client(async (url, init) => { urls.push(url); assert.equal(init.body, undefined); return Response.json({ data: {} }); });
  await sdk.getStatus(); await sdk.getQuoteInputOptions(); await sdk.getBreedLists({ postal_code: '02108' }); await sdk.getQuote(quoteId);
  assert.deepEqual(urls.map(u => u.replace('https://dev.api.rainwalk.io/partner/v1', '')), ['/status', '/quote-inputs', '/breed-lists?postal_code=02108', `/quotes/${quoteId}`]);
  assert.ok(urls.every(u => !u.includes(apiKey)));
});

test('plan selection posts the API payload with explicit idempotency and returns the price snapshot', async () => {
  const body = { offer_id: '22222222-2222-4222-8222-222222222222', billing_frequency: 'annual' };
  const sdk = client(async (url, init) => {
    assert.equal(url, `https://dev.api.rainwalk.io/partner/v1/quotes/${quoteId}/plan-selections`);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.get('idempotency-key'), 'plan-selection-1');
    assert.equal(init.headers.get('authorization'), `Api-Key ${apiKey}`);
    assert.deepEqual(JSON.parse(init.body), body);
    return Response.json({ data: { id: 'selection-1', ...body, price: { premium: { annual_total: '506.16' } } } }, { status: 201 });
  });
  const result = await sdk.selectPlan(quoteId, body, { idempotencyKey: 'plan-selection-1' });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.price.premium.annual_total, '506.16');
  assert.throws(() => sdk.selectPlan('../status', body, { idempotencyKey: 'selection' }));
  assert.throws(() => sdk.selectPlan(quoteId, body, { idempotencyKey: '' }));
});

test('selection conflicts and expired offers retain API error codes and do not trigger retries', async () => {
  for (const [status, code] of [[409, 'selection_conflict'], [422, 'offer_expired']]) {
    let calls = 0;
    const sdk = client(async () => { calls++; return Response.json({ error: { code, message: 'Selection failed.' } }, { status }); });
    await assert.rejects(sdk.selectPlan(quoteId, { offer_id: quoteId, billing_frequency: 'monthly' }, { idempotencyKey: 'selection' }), e => e instanceof RainwalkApiError && e.status === status && e.code === code);
    assert.equal(calls, 1);
  }
});

test('Stripe collection maps approved references into the provider-neutral API request', async () => {
  const reference = createStripePaymentReference({ accountReference: 'approved-test-account', customerReference: 'cus_Test123', paymentMethodReference: 'pm_Test123', type: 'card' });
  const sdk = client(async (url, init) => {
    assert.equal(url, 'https://dev.api.rainwalk.io/partner/v1/payment-methods');
    assert.equal(init.headers.get('idempotency-key'), 'payment-reference');
    assert.deepEqual(JSON.parse(init.body), { provider: 'stripe', provider_account_reference: 'approved-test-account', provider_customer_reference: 'cus_Test123', provider_payment_method_reference: 'pm_Test123', type: 'card' });
    return Response.json({ data: { id: quoteId, status: 'pending_verification' } }, { status: 201 });
  });
  const result = await sdk.registerPaymentMethodReference(reference, { idempotencyKey: 'payment-reference' });
  assert.equal(result.body.data.status, 'pending_verification');
  assert.equal(result.status, 201);
});

test('raw payment fields, nested extras, client secrets and unsupported references never reach transport', () => {
  const sdk = client(() => assert.fail('Unsafe payment input must not leave the process'));
  const reference = createStripePaymentReference({ accountReference: 'approved-account', customerReference: 'cus_Test', paymentMethodReference: 'pm_Test', type: 'bank_account' });
  for (const value of [
    { ...reference, card_number: 'synthetic-not-a-card' }, { ...reference, nested: { cvv: 'synthetic' } },
    { ...reference, provider_payment_method_reference: 'pi_Test_secret_Test' },
    { ...reference, provider_customer_reference: '' }, { ...reference, provider: 'unknown' },
  ]) assert.throws(() => sdk.registerPaymentMethodReference(value, { idempotencyKey: 'reference' }), PaymentReferenceValidationError);
});

test('sandbox factory supports only the four documented scenarios and never disguises them as Stripe', async () => {
  for (const scenario of ['success', 'decline', 'pending', 'rejected']) {
    const reference = createSandboxPaymentReference(scenario);
    assert.equal(reference.provider, 'sandbox_simulator'); assert.equal(reference.provider_account_reference, 'rw_sim_account');
    assert.equal(reference.provider_customer_reference, 'rw_sim_customer'); assert.equal(reference.provider_payment_method_reference, `rw_sim_${scenario}`);
    const sdk = client(async (_url, init) => {
      assert.deepEqual(JSON.parse(init.body), reference);
      return Response.json({ data: { id: quoteId, provider: 'sandbox_simulator', simulated: true, status: scenario === 'rejected' ? 'rejected' : 'approved' } }, { status: 201 });
    });
    const response = await sdk.registerPaymentMethodReference(reference, { idempotencyKey: scenario });
    assert.equal(response.body.data.simulated, true);
    assert.throws(() => sdk.registerPaymentMethodReference({ ...reference, provider: 'stripe' }, { idempotencyKey: 'spoofed' }), PaymentReferenceValidationError);
  }
  assert.throws(() => createSandboxPaymentReference('unknown'), PaymentReferenceValidationError);
});

test('bind retries use identical payload/key and a 202 response is not treated as a completed payment', async () => {
  const body = { quote_id: quoteId, plan_selection_id: quoteId, payment_method_id: quoteId, consent: { accepted_at: '2026-11-17T22:00:00Z', terms_version: 'synthetic-test-v1' } };
  const calls = [];
  const sdk = client(async (url, init) => {
    calls.push(init);
    assert.equal(url, 'https://dev.api.rainwalk.io/partner/v1/binds');
    return Response.json({ data: { id: quoteId, status: 'processing', payment: { status: 'approved', attempt_status: 'pending' }, policy: null } }, { status: 202 });
  });
  const result = await sdk.createBind(body, { idempotencyKey: 'immutable-bind' });
  await sdk.createBind(body, { idempotencyKey: 'immutable-bind' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers.get('idempotency-key'), calls[1].headers.get('idempotency-key'));
  assert.deepEqual(JSON.parse(calls[0].body).consent, body.consent);
  assert.equal(result.status, 202); assert.equal(result.body.data.status, 'processing');
  assert.equal(result.body.data.payment.attempt_status, 'pending');
  assert.throws(() => sdk.createBind(body, { idempotencyKey: '' }));
  for (const invalid of [{ ...body, amount: '1.00' }, { ...body, paid: true }, { ...body, consent: { ...body.consent, card_number: 'synthetic' } }, { ...body, consent: { ...body.consent, accepted_at: 'invalid' } }]) {
    assert.throws(() => client(() => assert.fail('Must not forward payment data or assertions')).createBind(invalid, { idempotencyKey: 'invalid' }));
  }
});

test('payment, bind and policy reads and collection pagination preserve IDs and money/date values', async () => {
  const urls = [];
  const sdk = client(async (url, init) => {
    urls.push(url); assert.equal(init.method, 'GET');
    return Response.json({ data: { status: 'pending_effective_date', issued_at: '2026-11-17', effective_at: '2026-12-01', billing: { amount: '55.77' } }, page: { has_more: true, next_cursor: 'opaque+/=' } });
  });
  await sdk.getPaymentMethod(quoteId); await sdk.getBind(quoteId);
  const policy = await sdk.getPolicy(quoteId);
  const methods = await sdk.listPaymentMethods({ limit: 50, cursor: 'opaque+/=' });
  await sdk.listPolicies({ limit: 100 });
  assert.deepEqual(urls.map(u => u.replace('https://dev.api.rainwalk.io/partner/v1', '')), [
    `/payment-methods/${quoteId}`, `/binds/${quoteId}`, `/policies/${quoteId}`, '/payment-methods?limit=50&cursor=opaque%2B%2F%3D', '/policies?limit=100',
  ]);
  assert.equal(policy.body.data.billing.amount, '55.77'); assert.equal(policy.body.data.effective_at, '2026-12-01');
  assert.equal(methods.body.page.next_cursor, 'opaque+/=');
  assert.throws(() => sdk.getPaymentMethod('../status')); assert.throws(() => sdk.getBind('../status')); assert.throws(() => sdk.getPolicy('../status'));
  for (const limit of [0, 101, 1.5, NaN]) assert.throws(() => sdk.listPolicies({ limit }));
});

test('conditional reference requests accept bodyless 304 and retain ETag', async () => {
  const sdk = client(async (_url, init) => {
    assert.equal(init.headers.get('if-none-match'), '"revision"');
    return new Response(null, { status: 304, headers: { ETag: '"revision"' } });
  });
  for (const result of [await sdk.getQuoteInputOptions({ ifNoneMatch: '"revision"' }), await sdk.getBreedLists({ state: 'TX' }, { ifNoneMatch: '"revision"' })]) {
    assert.equal(result.status, 304); assert.equal(result.body, undefined); assert.equal(result.metadata.etag, '"revision"');
  }
});

test('API errors retain nested or list details, request IDs, and rate limit metadata', async () => {
  for (const details of [{ pet: { breed: ['Invalid breed.'] } }, [{ field: 'pet.breed', reason: 'invalid' }]]) {
    const sdk = client(async () => Response.json({ error: { code: 'rate_limited', message: 'Try later.', details, request_id: 'req_body' } }, {
      status: 429, headers: { 'Retry-After': '60', 'RateLimit-Remaining': '0', 'RateLimit-Limit': '30', 'RateLimit-Reset': '123' },
    }));
    await assert.rejects(sdk.getStatus(), e => {
      assert.ok(e instanceof RainwalkApiError); assert.equal(e.status, 429); assert.equal(e.code, 'rate_limited');
      assert.equal(e.requestId, 'req_body'); assert.deepEqual(e.details, details);
      assert.equal(e.metadata.retryAfter, '60'); assert.equal(e.metadata.rateLimit.remaining, '0'); return true;
    });
  }
});

test('non-JSON errors do not expose proxy bodies and successful malformed JSON is rejected', async () => {
  await assert.rejects(client(async () => new Response('upstream private content', { status: 502 })).getStatus(), e => e.code === 'http_error' && !e.message.includes('private'));
  await assert.rejects(client(async () => new Response('<html>')).getStatus(), e => e instanceof RainwalkTransportError && e.kind === 'invalid_response');
});

test('cancellation, timeout and network failure have distinct sanitized errors', async () => {
  const blocking = async (_url, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) reject(init.signal.reason);
    else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client(blocking).getStatus({ signal: controller.signal }), e => e.kind === 'aborted');
  const keepAlive = setInterval(() => {}, 100);
  try { await assert.rejects(client(blocking, { timeoutMs: 10 }).getStatus(), e => e.kind === 'timeout'); }
  finally { clearInterval(keepAlive); }
  await assert.rejects(client(async () => { throw new Error(apiKey); }).getStatus(), e => e.kind === 'network' && !e.message.includes(apiKey));
});

test('rejects unsafe configurations and invalid route/idempotency inputs before sending', () => {
  for (const baseUrl of ['http://external.test', 'https://user:pass@example.test', 'https://example.test?secret=1']) {
    assert.throws(() => client(fetch, { baseUrl }));
  }
  assert.throws(() => client(fetch, { timeoutMs: 0 }));
  assert.throws(() => client(fetch, { apiKey: '' }));
  const sdk = client(() => assert.fail('Must not send invalid input'));
  assert.throws(() => sdk.createQuote(input, { idempotencyKey: '' }));
  assert.throws(() => sdk.createQuote(input, { idempotencyKey: 'bad\nkey' }));
  assert.throws(() => sdk.getQuote('../status'));
  assert.throws(() => sdk.getBreedLists({ state: 'TX', postal_code: '78701' }));
});
