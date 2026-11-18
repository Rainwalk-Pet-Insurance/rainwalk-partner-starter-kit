import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { Bind, PaymentMethod, PlanSelection, Policy } from '@rainwalk/partner-sdk';
import { pollingDelay } from '../lib/polling';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:3000' });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true }, document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true }, HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  FormData: { value: dom.window.FormData, configurable: true }, IS_REACT_ACT_ENVIRONMENT: { value: true, writable: true, configurable: true },
});
const { createElement, useState } = await import('react');
const { render, screen, waitFor, cleanup, act } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { Checkout } = await import('../app/checkout');

const quoteId = '11111111-1111-4111-8111-111111111111';
const selectionId = '33333333-3333-4333-8333-333333333333';
const methodId = '44444444-4444-4444-8444-444444444444';
const bindId = '55555555-5555-4555-8555-555555555555';
const policyId = '77777777-7777-4777-8777-777777777777';
const created = '2026-11-17T22:00:00Z';
const selection: PlanSelection = { data: { id: selectionId, quote_id: quoteId, offer_id: quoteId, status: 'selected', billing_frequency: 'monthly', created_at: created,
  price: { annual_limit: 15000, deductible: 500, reimbursement_percent: 80, billing_options: ['monthly', 'annual'], premium: { monthly_total: '55.77', annual_total: '669.24', currency: 'USD' } } } };
function payment(status: PaymentMethod['data']['status']): PaymentMethod {
  return { data: { id: methodId, provider: 'stripe', status, type: 'card', display: status === 'approved' ? { brand: 'visa', last4: '4242' } : {}, created_at: created } };
}
function binding(status: Bind['data']['status'], attempt_status: NonNullable<Bind['data']['payment']['attempt_status']> = 'pending'): Bind {
  return { data: { id: bindId, quote_id: quoteId, plan_selection_id: selectionId, status, created_at: created,
    payment: { status: 'approved', attempt_status, failure_code: attempt_status === 'failed' ? 'payment_method_declined' : null },
    policy: { id: policyId, status: status === 'bound' ? 'pending_effective_date' : 'payment_pending' } } };
}
const policy: Policy = { data: { id: policyId, policy_number: 'SYNTHETIC-TEST-POLICY', status: 'pending_effective_date', plan: 'monthly', issued_at: '2026-11-17', effective_at: '2026-12-01',
  coverage: { annual_limit: 15000, deductible: 500, reimbursement_percent: 80 }, billing: { status: 'active', amount: '55.77', currency: 'USD', billing_source: 'stripe', next_payment_at: null }, created_at: created, updated_at: created } };
function success(body: unknown, status = 200, retryAfter?: string) { return Response.json({ status, body, metadata: { requestId: 'req_synthetic', retryAfter, idempotentReplay: false } }, { status }); }
function fail(status: number, code: string, retryAfter?: string) { return Response.json({ error: { code, message: `Synthetic ${code}`, request_id: 'req_failure' }, metadata: { retryAfter } }, { status }); }
function Harness() {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState('not_started');
  return createElement('div', null,
    createElement(Checkout, { quoteId, selection, busy, onBusyChange: setBusy, onBindingState: setState }),
    createElement('p', { 'data-testid': 'binding-state' }, state));
}
async function register(user: ReturnType<typeof userEvent.setup>, suffix = 'Test') {
  await user.selectOptions(screen.getByLabelText('Payment integration'), 'stripe');
  await user.type(screen.getByLabelText('Approved account reference'), 'approved-test-account');
  await user.type(screen.getByLabelText('Stripe customer reference'), `cus_${suffix}`);
  await user.type(screen.getByLabelText('Stripe PaymentMethod reference'), `pm_${suffix}`);
  await user.click(screen.getByRole('button', { name: 'Register payment reference' }));
}
async function consent(user: ReturnType<typeof userEvent.setup>, terms = 'synthetic-test-v1') {
  await user.type(screen.getByLabelText('Agreed terms version'), terms);
  await user.click(screen.getByRole('checkbox', { name: 'Policyholder consent has been recorded for these terms' }));
  await user.click(screen.getByRole('button', { name: 'Request sandbox binding' }));
}

test('pending reference → approved → processing bind → succeeded → policy details uses authoritative states', async () => {
  const original = globalThis.fetch; const calls: string[] = [];
  globalThis.fetch = async (path, init) => {
    calls.push(String(path));
    if (path === '/api/payment-methods') return success(payment('pending_verification'), 201);
    if (path === `/api/payment-methods/${methodId}`) return success(payment('approved'));
    if (path === '/api/binds') {
      const body = JSON.parse(init?.body as string);
      assert.equal(body.quote_id, quoteId); assert.equal(body.plan_selection_id, selectionId); assert.equal(body.payment_method_id, methodId);
      assert.equal(body.consent.terms_version, 'synthetic-test-v1'); assert.ok(body.consent.accepted_at);
      return success(binding('processing'), 202);
    }
    if (path === `/api/binds/${bindId}`) return success(binding('bound', 'succeeded'));
    if (path === `/api/policies/${policyId}`) return success(policy);
    throw new Error(`Unexpected ${path}`);
  };
  try {
    const user = userEvent.setup(); render(createElement(Harness)); await register(user);
    await screen.findByText('Payment reference: pending_verification');
    assert.equal(screen.queryByRole('button', { name: 'Request sandbox binding' }), null);
    await user.click(screen.getByRole('button', { name: 'Check reference status' }));
    await screen.findByText('Payment reference: approved');
    assert.equal(screen.queryByText(/Payment succeeded\./), null);
    await consent(user); await screen.findByText('Bind status: processing');
    assert.equal(screen.getByTestId('binding-state').textContent, 'uncertain');
    assert.equal(screen.queryByText(/Payment succeeded\./), null);
    await user.click(screen.getByRole('button', { name: 'Check bind status' }));
    await screen.findByText('Policy number: SYNTHETIC-TEST-POLICY');
    assert.ok(screen.getByText('Status: pending_effective_date'));
    assert.ok(screen.getByText('Issue date: 2026-11-17')); assert.ok(screen.getByText('Effective date: 2026-12-01'));
    assert.ok(screen.getByText(/Billing: active · 55.77 USD/));
    assert.equal(screen.getByTestId('binding-state').textContent, 'terminal');
    assert.equal(calls.filter(path => path === '/api/binds').length, 1);
  } finally { cleanup(); globalThis.fetch = original; }
});

test('unknown bind outcomes freeze consent and replay identical body/key; duplicate clicks do not create another bind', async () => {
  const original = globalThis.fetch; const attempts: { body: string; key: string | null }[] = [];
  let resolveBind: ((value: Response) => void) | undefined;
  globalThis.fetch = async (path, init) => {
    if (path === '/api/payment-methods') return success(payment('approved'), 201);
    if (path === '/api/binds') {
      attempts.push({ body: init?.body as string, key: new Headers(init?.headers).get('idempotency-key') });
      if (attempts.length === 1) return fail(504, 'timeout');
      return new Promise(resolve => { resolveBind = resolve; });
    }
    throw new Error(`Unexpected ${path}`);
  };
  try {
    const user = userEvent.setup(); render(createElement(Harness)); await register(user); await screen.findByText('Payment reference: approved');
    await consent(user); await screen.findByText('Synthetic timeout');
    assert.equal(screen.queryByLabelText('Agreed terms version'), null);
    assert.equal(screen.queryByRole('button', { name: 'Use another Stripe reference' }), null);
    assert.equal(screen.getByTestId('binding-state').textContent, 'uncertain');
    await user.dblClick(screen.getByRole('button', { name: 'Retry original bind request' }));
    assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]);
    await act(async () => { resolveBind!(success(binding('processing'), 202)); });
    await screen.findByText('Bind status: processing');
  } finally { cleanup(); globalThis.fetch = original; }
});

test('a definite pre-bind rejection allows correcting the reference and creates a fresh request only after correction', async () => {
  const original = globalThis.fetch; const attempts: { body: string; key: string | null }[] = [];
  globalThis.fetch = async (path, init) => {
    if (path === '/api/payment-methods') return success(payment('approved'), 201);
    if (path === '/api/binds') {
      attempts.push({ body: init?.body as string, key: new Headers(init?.headers).get('idempotency-key') });
      return attempts.length === 1 ? fail(422, 'payment_method_not_approved') : success(binding('processing'), 202);
    }
    throw new Error(`Unexpected ${path}`);
  };
  try {
    const user = userEvent.setup(); render(createElement(Harness)); await register(user); await screen.findByText('Payment reference: approved');
    await consent(user); await screen.findByText('Synthetic payment_method_not_approved');
    assert.equal(screen.getByTestId('binding-state').textContent, 'not_started');
    await user.click(screen.getByRole('button', { name: 'Use another Stripe reference' }));
    await register(user, 'Replacement'); await screen.findByText('Payment reference: approved');
    await consent(user, 'synthetic-corrected-terms'); await screen.findByText('Bind status: processing');
    assert.notEqual(attempts[0].key, attempts[1].key);
    assert.equal(JSON.parse(attempts[1].body).consent.terms_version, 'synthetic-corrected-terms');
  } finally { cleanup(); globalThis.fetch = original; }
});

test('approved reference with a declined charge is never presented as payment success', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async path => {
    if (path === '/api/payment-methods') return success(payment('approved'), 201);
    if (path === '/api/binds') return success(binding('payment_failed', 'failed'), 202);
    throw new Error('Must not fetch an issued policy for a failed payment');
  };
  try {
    const user = userEvent.setup(); render(createElement(Harness)); await register(user); await screen.findByText('Payment reference: approved'); await consent(user);
    await screen.findByText('Bind status: payment_failed');
    assert.ok(screen.getByText('Charge status: failed')); assert.ok(screen.getByText('Payment failure: payment_method_declined'));
    assert.equal(screen.queryByText(/Payment succeeded\./), null);
    assert.equal(screen.queryByText('Policy number: SYNTHETIC-TEST-POLICY'), null);
    assert.equal(screen.getByTestId('binding-state').textContent, 'terminal');
  } finally { cleanup(); globalThis.fetch = original; }
});

test('rejected references and unconfirmed bound outcomes cannot imply successful payment', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => success(payment('rejected'), 201);
    let user = userEvent.setup(); render(createElement(Harness)); await register(user);
    await screen.findByText('Payment reference: rejected');
    assert.equal(screen.queryByRole('button', { name: 'Request sandbox binding' }), null); cleanup();
    globalThis.fetch = async path => path === '/api/payment-methods' ? success(payment('approved'), 201) : success(binding('bound', 'processing'), 202);
    user = userEvent.setup(); render(createElement(Harness)); await register(user); await screen.findByText('Payment reference: approved'); await consent(user);
    await screen.findByText('Bind status: bound');
    assert.equal(screen.queryByText(/Payment succeeded\./), null);
    assert.equal(screen.getByTestId('binding-state').textContent, 'uncertain');
  } finally { cleanup(); globalThis.fetch = original; }
});

test('policy retrieval failure preserves the successful bind and can be retried independently', async () => {
  const original = globalThis.fetch; let bindCalls = 0; let policyCalls = 0;
  globalThis.fetch = async path => {
    if (path === '/api/payment-methods') return success(payment('approved'), 201);
    if (path === '/api/binds') { bindCalls++; return success(binding('bound', 'succeeded'), 202); }
    if (path === `/api/policies/${policyId}`) { policyCalls++; return policyCalls === 1 ? fail(503, 'service_unavailable') : success(policy); }
    throw new Error(`Unexpected ${path}`);
  };
  try {
    const user = userEvent.setup(); render(createElement(Harness)); await register(user); await screen.findByText('Payment reference: approved'); await consent(user);
    await screen.findByText('Synthetic service_unavailable');
    assert.equal(screen.getByTestId('binding-state').textContent, 'terminal');
    await user.click(screen.getByRole('button', { name: 'Retrieve policy' })); await screen.findByText('Policy number: SYNTHETIC-TEST-POLICY');
    assert.equal(bindCalls, 1); assert.equal(policyCalls, 2);
  } finally { cleanup(); globalThis.fetch = original; }
});

test('automatic resource polling backs off and stops after ten reads without replaying mutations', async t => {
  const original = globalThis.fetch; let reads = 0; let registrations = 0;
  globalThis.fetch = async path => {
    if (path === '/api/payment-methods') { registrations++; return success(payment('pending_verification'), 201); }
    if (path === `/api/payment-methods/${methodId}`) { reads++; return success(payment('pending_verification')); }
    throw new Error(`Unexpected ${path}`);
  };
  try {
    const user = userEvent.setup(); render(createElement(Harness)); await register(user); await screen.findByText('Payment reference: pending_verification');
    // Existing timer was installed before enabling mocked timers; restart it
    // through a normal UI pause/resume before advancing the fake clock.
    await user.click(screen.getByRole('button', { name: 'Pause automatic checks' }));
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    await act(async () => { (screen.getByRole('button', { name: 'Resume automatic checks' }) as HTMLButtonElement).click(); });
    for (let i = 0; i < 10; i++) await act(async () => { t.mock.timers.tick(pollingDelay(i)); });
    assert.equal(reads, 10); assert.equal(registrations, 1);
    await act(async () => { t.mock.timers.tick(300_000); });
    assert.equal(reads, 10); assert.ok(screen.getByText('Automatic checks paused. Use the status button to continue.'));
    assert.ok(screen.getByRole('button', { name: 'Resume automatic checks' }));
  } finally { cleanup(); t.mock.timers.reset(); globalThis.fetch = original; }
});

test('429 status reads respect Retry-After before automatic or manual checks resume', async t => {
  const original = globalThis.fetch; let reads = 0;
  globalThis.fetch = async path => {
    if (path === '/api/payment-methods') return success(payment('pending_verification'), 201);
    if (path === `/api/payment-methods/${methodId}`) { reads++; return reads === 1 ? fail(429, 'rate_limited', '45') : success(payment('approved')); }
    throw new Error(`Unexpected ${path}`);
  };
  try {
    const user = userEvent.setup(); render(createElement(Harness)); await register(user); await screen.findByText('Payment reference: pending_verification');
    await user.click(screen.getByRole('button', { name: 'Pause automatic checks' }));
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    await act(async () => { (screen.getByRole('button', { name: 'Resume automatic checks' }) as HTMLButtonElement).click(); });
    await act(async () => { t.mock.timers.tick(1000); });
    assert.equal(reads, 1); assert.ok(screen.getByText('Retry after: 45 seconds.'));
    assert.equal((screen.getByRole('button', { name: 'Check reference status' }) as HTMLButtonElement).disabled, true);
    await act(async () => { t.mock.timers.tick(44_999); }); assert.equal(reads, 1);
    await act(async () => { t.mock.timers.tick(1); });
    assert.equal(reads, 2); assert.ok(screen.getByText('Payment reference: approved'));
  } finally { cleanup(); t.mock.timers.reset(); globalThis.fetch = original; }
});

test('authorization changes and conflicts after a bind request never unlock a replacement purchase', async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, code] of [[403, 'permission_denied'], [409, 'bind_conflict'], [409, 'request_in_progress']] as const) {
      globalThis.fetch = async path => path === '/api/payment-methods' ? success(payment('approved'), 201) : fail(status, code);
      const user = userEvent.setup(); render(createElement(Harness)); await register(user); await screen.findByText('Payment reference: approved'); await consent(user);
      await screen.findByText(`Synthetic ${code}`);
      assert.equal(screen.getByTestId('binding-state').textContent, 'uncertain');
      assert.equal(screen.queryByLabelText('Agreed terms version'), null);
      assert.equal(screen.queryByRole('button', { name: 'Use another Stripe reference' }), null);
      cleanup();
    }
  } finally { cleanup(); globalThis.fetch = original; }
});

test('read backoff respects numeric and HTTP-date Retry-After without unbounded exponentiation', () => {
  assert.equal(pollingDelay(0), 1000); assert.equal(pollingDelay(2), 4000); assert.equal(pollingDelay(100), 30_000);
  assert.equal(pollingDelay(0, '45'), 45_000);
  assert.equal(pollingDelay(0, 'Tue, 17 Nov 2026 22:01:00 GMT', Date.parse('2026-11-17T22:00:00Z')), 60_000);
  assert.equal(pollingDelay(0, 'not-a-date'), 1000);
});

test('simulator picker exercises all four scenarios and clearly marks test policies without Stripe collection', async () => {
  const original = globalThis.fetch;
  try {
    for (const scenario of ['success', 'decline', 'pending', 'rejected']) {
      let registered = false;
      globalThis.fetch = async (path, init) => {
        if (path === '/api/payment-methods') {
          const body = JSON.parse(init?.body as string);
          assert.equal(body.provider, 'sandbox_simulator'); assert.equal(body.provider_payment_method_reference, `rw_sim_${scenario}`);
          registered = true;
          return success({ data: { ...payment(scenario === 'rejected' ? 'rejected' : 'approved').data, provider: 'sandbox_simulator', simulated: true } }, 201);
        }
        if (path === '/api/binds') {
          assert.notEqual(scenario, 'rejected');
          return success({ data: { ...binding(scenario === 'pending' ? 'processing' : scenario === 'decline' ? 'payment_failed' : 'bound', scenario === 'pending' ? 'processing' : scenario === 'decline' ? 'failed' : 'succeeded').data, simulated: true } }, 202);
        }
        if (path === `/api/binds/${bindId}`) return success({ data: { ...binding('bound', 'succeeded').data, simulated: true } });
        if (path === `/api/policies/${policyId}`) return success({ data: { ...policy.data, policy_number: 'SIM-TEST', status: 'test_policy', simulated: true, billing: { ...policy.data.billing, status: 'inactive', billing_source: 'sandbox_simulator' } } });
        throw new Error(`Unexpected ${path}`);
      };
      const user = userEvent.setup(); render(createElement(Harness));
      assert.equal((screen.getByLabelText('Payment integration') as HTMLSelectElement).value, 'sandbox_simulator');
      assert.equal(screen.queryByLabelText('Stripe customer reference'), null);
      await user.selectOptions(screen.getByLabelText('Payment scenario'), scenario);
      await user.click(screen.getByRole('button', { name: 'Register simulated reference' }));
      await screen.findByText(`Payment reference: ${scenario === 'rejected' ? 'rejected' : 'approved'}`);
      assert.equal(registered, true); assert.ok(screen.getByText('Simulated payment · no real funds or coverage'));
      if (scenario === 'rejected') assert.equal(screen.queryByRole('button', { name: 'Request sandbox binding' }), null);
      else {
        await consent(user);
        if (scenario === 'pending') { await screen.findByText('Bind status: processing'); await user.click(screen.getByRole('button', { name: 'Check bind status' })); }
        if (scenario === 'decline') await screen.findByText('Charge status: failed');
        else { await screen.findByText('Policy number: SIM-TEST'); assert.ok(screen.getByText('Test policy only · no insurance coverage')); assert.ok(screen.getByText('Status: test_policy')); }
        assert.equal(screen.queryByText('Payment succeeded. Check the policy status and effective date below for coverage.'), null);
      }
      cleanup();
    }
  } finally { cleanup(); globalThis.fetch = original; }
});

test('sandbox access denial before bind is a definite rejection that allows correction with a new key', async () => {
  const original = globalThis.fetch; const keys: (string | null)[] = [];
  globalThis.fetch = async (path, init) => {
    if (path === '/api/payment-methods') return success({ data: { ...payment('approved').data, provider: 'sandbox_simulator', simulated: true } }, 201);
    if (path === '/api/binds') {
      keys.push(new Headers(init?.headers).get('idempotency-key'));
      return keys.length === 1 ? fail(422, 'payment_provider_not_approved') : success({ data: { ...binding('processing').data, simulated: true } }, 202);
    }
    throw new Error(`Unexpected ${path}`);
  };
  try {
    const user = userEvent.setup(); render(createElement(Harness));
    await user.selectOptions(screen.getByLabelText('Payment integration'), 'sandbox_simulator');
    await user.click(screen.getByRole('button', { name: 'Register simulated reference' }));
    await screen.findByText('Payment reference: approved'); await consent(user);
    await screen.findByText('Synthetic payment_provider_not_approved');
    assert.equal(screen.getByTestId('binding-state').textContent, 'not_started');
    assert.ok(screen.getByRole('button', { name: 'Use another simulated reference' }));
    await consent(user, 'synthetic-after-operator-correction');
    await screen.findByText('Bind status: processing');
    assert.notEqual(keys[0], keys[1]);
  } finally { cleanup(); globalThis.fetch = original; }
});
