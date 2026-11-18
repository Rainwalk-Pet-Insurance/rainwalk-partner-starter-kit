import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RainwalkClient } from '@rainwalk/partner-sdk';
import { handleRequest } from '../lib/server';

const secret = 'synthetic-server-key';
function request(path: string, options?: RequestInit) { return new Request(`http://127.0.0.1:3000/api/${path}`, options); }
function sdk(transport: typeof fetch) { return () => new RainwalkClient({ apiKey: secret, environment: 'sandbox', fetch: transport }); }

test('quote POST forwards to sandbox with server credential and original idempotency key', async () => {
  const input = { policyholder: { email: 'ava@example.test' }, pet: { name: 'Mochi' } };
  const response = await handleRequest(request('quotes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'logical-request', Origin: 'http://127.0.0.1:3000' }, body: JSON.stringify(input) }), sdk(async (url, init) => {
    assert.equal(url, 'https://dev.api.rainwalk.io/partner/v1/quotes');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), `Api-Key ${secret}`);
    assert.equal(headers.get('idempotency-key'), 'logical-request');
    assert.ok(headers.get('x-correlation-id'));
    assert.deepEqual(JSON.parse(init!.body as string), input);
    return Response.json({ data: { id: 'quote', offers: [] } }, { status: 201, headers: { 'X-Request-Id': 'req_quote' } });
  }));
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text(); assert.ok(!text.includes(secret)); assert.equal(JSON.parse(text).metadata.requestId, 'req_quote');
});

test('reference routes and retrieval use the SDK; arbitrary proxy paths are rejected', async () => {
  for (const path of ['status', 'quote-inputs', 'breed-lists?postal_code=78701', 'quotes/11111111-1111-4111-8111-111111111111']) {
    const result = await handleRequest(request(path), sdk(async url => { assert.ok(String(url).endsWith(path)); return Response.json({ data: {} }); }));
    assert.equal(result.status, 200);
  }
  const result = await handleRequest(request('binds'), () => assert.fail('Not an open proxy'));
  assert.equal(result.status, 404);
});

test('plan selection uses the allowlisted nested route and forwards body and idempotency key', async () => {
  const quoteId = '11111111-1111-4111-8111-111111111111';
  const input = { offer_id: '22222222-2222-4222-8222-222222222222', billing_frequency: 'monthly' };
  const path = `quotes/${quoteId}/plan-selections`;
  const response = await handleRequest(request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'selection-key' }, body: JSON.stringify(input) }), sdk(async (url, init) => {
    assert.equal(url, `https://dev.api.rainwalk.io/partner/v1/${path}`);
    assert.equal(new Headers(init?.headers).get('idempotency-key'), 'selection-key');
    assert.deepEqual(JSON.parse(init!.body as string), input);
    return Response.json({ data: { id: 'selection', ...input } }, { status: 201 });
  }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).body.data.id, 'selection');
  const noClient = () => assert.fail('Must not forward this request');
  assert.equal((await handleRequest(request(path), noClient)).status, 404);
  assert.equal((await handleRequest(request(`quotes/not-a-uuid/plan-selections`, { method: 'POST' }), noClient)).status, 404);
  assert.equal((await handleRequest(request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), noClient)).status, 400);
});

test('purchase mutations and resource reads use only the sandbox API with explicit keys', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const reference = { provider: 'stripe', provider_account_reference: 'test-account', provider_customer_reference: 'cus_Test', provider_payment_method_reference: 'pm_Test', type: 'card' };
  const binding = { quote_id: id, plan_selection_id: id, payment_method_id: id, consent: { accepted_at: '2026-11-17T22:00:00Z', terms_version: 'synthetic-test' } };
  for (const [path, input, status] of [['payment-methods', reference, 201], ['binds', binding, 202]] as const) {
    const response = await handleRequest(request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'original-request' }, body: JSON.stringify(input) }), sdk(async (url, init) => {
      assert.equal(url, `https://dev.api.rainwalk.io/partner/v1/${path}`);
      assert.equal(new Headers(init?.headers).get('authorization'), `Api-Key ${secret}`);
      assert.equal(new Headers(init?.headers).get('idempotency-key'), 'original-request');
      assert.deepEqual(JSON.parse(init!.body as string), input);
      return Response.json({ data: { id, status: path === 'binds' ? 'processing' : 'pending_verification' } }, { status });
    }));
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes(secret));
  }
  for (const path of [`payment-methods/${id}`, `binds/${id}`, `policies/${id}`, 'payment-methods?limit=25&cursor=next', 'policies?limit=50']) {
    const response = await handleRequest(request(path), sdk(async url => { assert.ok(String(url).endsWith(path)); return Response.json({ data: {} }); }));
    assert.equal(response.status, 200);
  }
});

test('purchase proxy rejects raw payment data, invalid methods/IDs, invalid pagination and missing mutation keys', async () => {
  for (const raw of [{ card_number: 'synthetic' }, { provider: 'stripe', nested: { cvc: 'synthetic' } }]) {
    const response = await handleRequest(request('payment-methods', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'raw' }, body: JSON.stringify(raw) }), sdk(async () => assert.fail('Must not forward raw data')));
    assert.equal(response.status, 400);
  }
  const noClient = () => assert.fail('Must not obtain credentials');
  for (const path of ['binds/not-an-id', 'policies/not-an-id', 'payment-methods?limit=0', 'policies?limit=101', 'policies?limit=1&limit=2', 'payment-methods?other=x']) {
    // List queries are validated before an API call, while the SDK instance is harmless.
    const response = await handleRequest(request(path), path.includes('?') ? sdk(async () => assert.fail('Invalid query forwarded')) : noClient);
    assert.equal(response.status, path.includes('?') ? 400 : 404);
  }
  assert.equal((await handleRequest(request('binds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), noClient)).status, 400);
  assert.equal((await handleRequest(request('binds', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'unsafe-bind' }, body: JSON.stringify({ amount: '1.00', paid: true }) }), sdk(async () => assert.fail('Must not forward payment assertions')))).status, 400);
  assert.equal((await handleRequest(request('webhook-endpoints'), noClient)).status, 404);
});

test('accepts browser origin matching HTTP Host when Next normalizes the listener URL', async () => {
  const response = await handleRequest(new Request('http://localhost:3000/api/quotes', {
    method: 'POST', headers: { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000',
      'Content-Type': 'application/json', 'Idempotency-Key': 'normalized-loopback-request' },
    body: JSON.stringify({ pet: { name: 'Mochi' } }),
  }), sdk(async () => Response.json({ data: { id: 'quote', offers: [] } }, { status: 201 })));
  assert.equal(response.status, 201);
});

test('rejects hostile Host headers and mismatched browser origins despite a local listener', async () => {
  for (const [host, origin] of [
    ['external.example', 'http://external.example'],
    ['external.example@localhost:3000', 'http://localhost:3000'],
    ['localhost:3000/path', 'http://localhost:3000'],
    ['127.0.0.1:3000', 'http://localhost:3000'],
    ['127.0.0.1:3000', 'http://127.0.0.1:3001'],
    ['127.0.0.1:3000', 'null'],
  ]) {
    const response = await handleRequest(new Request('http://localhost:3000/api/status', { headers: { Host: host, Origin: origin } }), () => assert.fail('Must reject before obtaining credentials'));
    assert.equal(response.status, 403, `${host} / ${origin}`);
  }
});

test('rejects remote origins, foreign hosts, malformed JSON, invalid keys and oversized input before API access', async () => {
  const noClient = () => assert.fail('Must not access Rainwalk');
  assert.equal((await handleRequest(request('status', { headers: { Origin: 'https://evil.example' } }), noClient)).status, 403);
  assert.equal((await handleRequest(new Request('http://external.example/api/status'), noClient)).status, 403);
  assert.equal((await handleRequest(request('status', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), noClient)).status, 403);
  for (const [body, key, expected] of [['{', 'key', 400], ['[]', 'key', 400], ['{}', '', 400], ['x'.repeat(33_000), 'key', 413]] as const) {
    const result = await handleRequest(request('quotes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body }), noClient);
    assert.equal(result.status, expected);
  }
});

test('API validation and rate limit errors preserve actionable metadata', async () => {
  const response = await handleRequest(request('status'), sdk(async () => Response.json({ error: { code: 'missing_capability', message: 'Permission needed.', details: { required: 'partner.quote.read' } } }, { status: 403, headers: { 'X-Request-Id': 'req_denied', 'Retry-After': '30' } })));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.request_id, 'req_denied'); assert.equal(body.metadata.retryAfter, '30');
  assert.deepEqual(body.error.details, { required: 'partner.quote.read' });
});

test('configuration failures return a safe setup error without exception details', async () => {
  const response = await handleRequest(request('status'), () => { throw new Error(secret); });
  assert.equal(response.status, 500); const text = await response.text();
  assert.ok(text.includes('configuration_error')); assert.ok(!text.includes(secret));
});
