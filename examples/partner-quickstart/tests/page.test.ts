import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { components } from '@rainwalk/partner-sdk';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:3000' });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true }, document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  FormData: { value: dom.window.FormData, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, writable: true, configurable: true },
});
const { createElement } = await import('react');
const { render, screen, waitFor, cleanup } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { default: Page } = await import('../app/page');
const { PlanSelectionForm } = await import('../app/plan-selection');

const choices = {
  coverage_preferences: { annual_limit: { allowed_values: [5000, 15000] }, deductible: { allowed_values: [250, 500] }, reimbursement_percent: { allowed_values: [70, 80] } },
  pet: { species: { allowed_values: ['dog', 'cat'] }, sex: { allowed_values: ['female', 'male'] } },
};
const quoteId = '11111111-1111-4111-8111-111111111111';
const offer = { offer_id: '22222222-2222-4222-8222-222222222222', billing_options: ['monthly', 'annual'], expires_at: '2027-01-01T00:00:00Z', annual_limit: 5000, deductible: 250, reimbursement_percent: 70, premium: { monthly_total: '42.18', annual_total: '506.16', currency: 'USD' } } satisfies components['schemas']['Offer'];
const quote = { data: { id: quoteId, status: 'offered', offers: [offer] } };
const selected = { data: { id: '33333333-3333-4333-8333-333333333333', quote_id: quoteId, offer_id: offer.offer_id,
  status: 'selected', billing_frequency: 'monthly', price: { premium: { monthly_total: '45.00', annual_total: '540.00', currency: 'USD' } } } };
function success(body: unknown, status = 200) { return Response.json({ body, status, metadata: { requestId: 'req_example', idempotentReplay: false } }, { status }); }

test('first quote uses canonical options, preserves unknown-outcome retries, retrieves quote and starts a new request', async () => {
  const originalFetch = globalThis.fetch;
  const attempts: { key: string | null; body: string }[] = [];
  let retrieved = false;
  globalThis.fetch = async (path, init) => {
    if (path === '/api/status') return success({});
    if (path === '/api/quote-inputs') return success({ data: choices });
    if (String(path).startsWith('/api/breed-lists')) return success({ data: { state: 'TX', coverage_status: 'covered', dog: ['Canonical Dog'], cat: ['Canonical Cat'] } });
    if (path === '/api/quotes' && init?.method === 'POST') {
      attempts.push({ key: new Headers(init.headers).get('idempotency-key'), body: init.body as string });
      if (attempts.length === 1) return Response.json({ error: { code: 'timeout', message: 'The outcome is unknown.' } }, { status: 504 });
      return success(quote, 201);
    }
    if (path === `/api/quotes/${quoteId}`) { retrieved = true; return success(quote); }
    if (path === `/api/quotes/${quoteId}/plan-selections`) return success(selected, 201);
    throw new Error(`Unexpected request ${path}`);
  };
  try {
    const user = userEvent.setup(); render(createElement(Page));
    await screen.findByText('Sandbox connected · form choices loaded');
    assert.equal((screen.getByRole('button', { name: 'Get sandbox quote' }) as HTMLButtonElement).disabled, true);
    await user.click(screen.getByRole('button', { name: 'Load breeds' }));
    await screen.findByText('Breed list loaded for TX. ZIP and address must match.');
    await user.selectOptions(screen.getByLabelText('Breed'), 'Canonical Dog');
    await user.click(screen.getByRole('button', { name: 'Get sandbox quote' }));
    await screen.findByText('The outcome is unknown.');
    await user.click(screen.getByRole('button', { name: 'Get sandbox quote' }));
    await screen.findByText('$42.18');
    assert.equal(attempts.length, 2); assert.ok(attempts[0].key);
    assert.deepEqual(attempts[0], attempts[1]);
    const submitted = JSON.parse(attempts[0].body);
    assert.equal(submitted.pet.breed, 'Canonical Dog'); assert.equal(submitted.policyholder.address.state, 'TX');
    assert.equal(submitted.coverage_preferences.annual_limit, 5000);
    assert.equal(submitted.policyholder.email, 'ava@example.test');
    await user.click(screen.getByRole('button', { name: 'Retrieve saved quote' }));
    await waitFor(() => assert.equal(retrieved, true));
    await user.click(screen.getByRole('button', { name: 'Select this plan' }));
    await screen.findByText('Plan selected');
    assert.ok(screen.getByText(`Selection ID: ${selected.data.id}`));
    await user.click(screen.getByRole('button', { name: 'Retrieve saved quote' }));
    await waitFor(() => assert.equal((screen.getByRole('button', { name: 'Start a new quote' }) as HTMLButtonElement).disabled, false));
    assert.ok(screen.getByText('Plan selected'));
    await user.click(screen.getByRole('button', { name: 'Start a new quote' }));
    assert.equal(screen.queryByText('Plan selected'), null);
    await user.click(screen.getByRole('button', { name: 'Get sandbox quote' }));
    await screen.findByText('$42.18');
    assert.notEqual(attempts[2].key, attempts[1].key);
    await user.clear(screen.getByLabelText('ZIP code'));
    await user.type(screen.getByLabelText('ZIP code'), '90210');
    assert.equal((screen.getByRole('button', { name: 'Get sandbox quote' }) as HTMLButtonElement).disabled, true);
  } finally { cleanup(); globalThis.fetch = originalFetch; }
});

test('selection retries retain key/body across frequency changes and show the returned immutable price', async () => {
  const originalFetch = globalThis.fetch;
  const attempts: { key: string | null; body: string }[] = [];
  globalThis.fetch = async (path, init) => {
    assert.equal(path, `/api/quotes/${quoteId}/plan-selections`);
    attempts.push({ key: new Headers(init?.headers).get('idempotency-key'), body: init?.body as string });
    if (attempts.length === 1) return Response.json({ error: { code: 'timeout', message: 'Unknown selection outcome.' } }, { status: 504 });
    if (attempts.length === 2) return Response.json({ error: { code: 'selection_conflict', message: 'Frequency conflicts.', request_id: 'req_conflict' } }, { status: 409 });
    return success(selected, 201);
  };
  try {
    const user = userEvent.setup();
    render(createElement(PlanSelectionForm, { quoteId, offer, busy: false, onBusyChange: () => {} }));
    await user.click(screen.getByRole('button', { name: 'Select this plan' }));
    await screen.findByText('Unknown selection outcome.');
    await user.selectOptions(screen.getByRole('combobox'), 'annual');
    await user.click(screen.getByRole('button', { name: 'Select this plan' }));
    await screen.findByText('Frequency conflicts.');
    assert.ok(screen.getByText('Request ID: req_conflict'));
    await user.selectOptions(screen.getByRole('combobox'), 'monthly');
    await user.click(screen.getByRole('button', { name: 'Select this plan' }));
    await screen.findByText('Plan selected');
    assert.deepEqual(attempts[0], attempts[2]);
    assert.notEqual(attempts[0].key, attempts[1].key);
    assert.deepEqual(JSON.parse(attempts[0].body), { offer_id: offer.offer_id, billing_frequency: 'monthly' });
    assert.ok(screen.getByText('Selected price: $45.00 / month · USD'));
    assert.equal(screen.queryByRole('combobox'), null);
    assert.equal(screen.queryByRole('button', { name: 'Select this plan' }), null);
  } finally { cleanup(); globalThis.fetch = originalFetch; }
});

test('only API-supported billing options can be selected', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_path, init) => {
    assert.equal(JSON.parse(init?.body as string).billing_frequency, 'annual');
    return success({ data: { ...selected.data, billing_frequency: 'annual' } }, 201);
  };
  try {
    const user = userEvent.setup();
    render(createElement(PlanSelectionForm, { quoteId, offer: { ...offer, billing_options: ['annual'] }, busy: false, onBusyChange: () => {} }));
    assert.deepEqual(screen.getAllByRole('option').map(option => option.textContent), ['annual']);
    await user.click(screen.getByRole('button', { name: 'Select this plan' }));
    await screen.findByText('Plan selected');
    assert.ok(screen.getByText('Selected price: $540.00 / year · USD'));
  } finally { cleanup(); globalThis.fetch = originalFetch; }
});

test('expired-offer, permission and rate-limit failures do not show a successful selection', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, code] of [[422, 'offer_expired'], [403, 'permission_denied'], [429, 'rate_limited']] as const) {
      globalThis.fetch = async () => Response.json({ error: { code, message: 'Selection unavailable.', request_id: 'req_selection_error' }, metadata: { retryAfter: '30' } }, { status });
      const user = userEvent.setup();
      render(createElement(PlanSelectionForm, { quoteId, offer, busy: false, onBusyChange: () => {} }));
      await user.click(screen.getByRole('button', { name: 'Select this plan' }));
      await screen.findByText(`Code: ${code}`);
      assert.ok(screen.getByText('Retry after: 30 seconds.'));
      assert.ok(screen.getByText('Request ID: req_selection_error'));
      assert.equal(screen.queryByText('Plan selected'), null);
      cleanup();
    }
  } finally { cleanup(); globalThis.fetch = originalFetch; }
});

test('uncovered locations cannot submit a quote', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async path => {
    if (path === '/api/status') return success({});
    if (path === '/api/quote-inputs') return success({ data: choices });
    if (String(path).startsWith('/api/breed-lists')) return success({ data: { state: 'AK', coverage_status: 'uncovered', dog: [], cat: [] } });
    throw new Error('No quote request should be sent');
  };
  try {
    const user = userEvent.setup(); render(createElement(Page));
    await screen.findByText('Sandbox connected · form choices loaded');
    await user.click(screen.getByRole('button', { name: 'Load breeds' }));
    await screen.findByText('Coverage is currently unavailable in AK. Try another location.');
    assert.equal((screen.getByRole('button', { name: 'Get sandbox quote' }) as HTMLButtonElement).disabled, true);
  } finally { cleanup(); globalThis.fetch = originalFetch; }
});

test('rate limits display Retry-After, request ID and the API error message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: { code: 'rate_limited', message: 'Too many requests.', request_id: 'req_limited' },
    metadata: { retryAfter: '45' },
  }, { status: 429 });
  try {
    render(createElement(Page));
    await screen.findByText('Too many requests.');
    assert.ok(screen.getByText('Retry after: 45 seconds.'));
    assert.ok(screen.getByText('Request ID: req_limited'));
    assert.equal(screen.queryByRole('button', { name: 'Get sandbox quote' }), null);
  } finally { cleanup(); globalThis.fetch = originalFetch; }
});
