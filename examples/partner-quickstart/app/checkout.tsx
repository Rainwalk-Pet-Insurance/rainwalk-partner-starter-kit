'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiResponse, Bind, BindRequest, PaymentMethod, PaymentMethodReferenceRequest, PlanSelection, Policy } from '@rainwalk/partner-sdk';
import { call, failure, type Failure } from '../lib/browser-api';
import { pollingDelay } from '../lib/polling';
import { PaymentReferenceCollector } from './payment-reference-collector';

type Attempt = { key: string; body: string };
export type BindingState = 'not_started' | 'uncertain' | 'terminal';
function finalBind(bind: Bind['data']) {
  return ['declined', 'payment_failed', 'cancelled'].includes(bind.status) ||
    (bind.status === 'bound' && bind.payment.attempt_status === 'succeeded');
}

export function Checkout({ quoteId, selection, busy, onBusyChange, onBindingState }: {
  quoteId: string; selection: PlanSelection; busy: boolean;
  onBusyChange: (busy: boolean) => void; onBindingState: (state: BindingState) => void;
}) {
  const [payment, setPayment] = useState<ApiResponse<PaymentMethod>>();
  const [bind, setBind] = useState<ApiResponse<Bind>>();
  const [policy, setPolicy] = useState<ApiResponse<Policy>>();
  const [error, setError] = useState<Failure>();
  const [bindingStarted, setBindingStarted] = useState(false);
  const [auto, setAuto] = useState(true);
  const [round, setRound] = useState(0);
  const [readBlockedUntil, setReadBlockedUntil] = useState(0);
  const paymentAttempts = useRef(new Map<string, Attempt>());
  const bindAttempt = useRef<Attempt | undefined>(undefined);
  const pending = useRef(false);
  const policyAutoRead = useRef('');
  const mounted = useRef(true);
  const activeRead = useRef<AbortController | undefined>(undefined);
  const callbacks = useRef({ onBusyChange, onBindingState });
  callbacks.current = { onBusyChange, onBindingState };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeRead.current?.abort(); };
  }, []);
  const pendingPayment = payment?.body.data.status === 'pending_verification';
  const pendingBind = !!bind && !finalBind(bind.body.data);
  const pendingResource = pendingBind ? 'bind' : pendingPayment ? 'payment' : undefined;

  function cooldown(value?: string | null) {
    if (value) setReadBlockedUntil(Date.now() + pollingDelay(0, value));
  }
  function showError(e: unknown) {
    const value = failure(e); setError(value); cooldown(value.retry_after);
    if (value.status && value.status < 500 && value.status !== 429) setAuto(false);
  }
  function saveBind(result: ApiResponse<Bind>) {
    setBind(result); cooldown(result.metadata.retryAfter);
    callbacks.current.onBindingState(finalBind(result.body.data) ? 'terminal' : 'uncertain');
  }

  async function register(reference: PaymentMethodReferenceRequest) {
    if (busy || pending.current || bindingStarted || payment) return;
    const body = JSON.stringify(reference);
    let attempt = paymentAttempts.current.get(body);
    if (!attempt) { attempt = { key: crypto.randomUUID(), body }; paymentAttempts.current.set(body, attempt); }
    pending.current = true; onBusyChange(true); setError(undefined);
    try {
      const result = await call<PaymentMethod>('payment-methods', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key }, body: attempt.body });
      if (!mounted.current) return;
      setPayment(result); cooldown(result.metadata.retryAfter); setRound(0); setAuto(true);
    } catch (e) { if (mounted.current) showError(e); }
    finally { pending.current = false; if (mounted.current) callbacks.current.onBusyChange(false); }
  }

  async function refresh(kind: 'payment' | 'bind' | 'policy') {
    if (busy || pending.current || readBlockedUntil > Date.now()) return;
    const id = kind === 'payment' ? payment?.body.data.id : kind === 'bind' ? bind?.body.data.id : bind?.body.data.policy?.id;
    if (!id) return;
    pending.current = true; onBusyChange(true); setError(undefined);
    const controller = new AbortController(); activeRead.current = controller;
    try {
      const path = kind === 'payment' ? 'payment-methods' : kind === 'bind' ? 'binds' : 'policies';
      const result = await call<PaymentMethod | Bind | Policy>(`${path}/${id}`, { signal: controller.signal });
      if (!mounted.current) return;
      if (kind === 'payment') setPayment(result as ApiResponse<PaymentMethod>);
      else if (kind === 'bind') saveBind(result as ApiResponse<Bind>);
      else setPolicy(result as ApiResponse<Policy>);
      cooldown(result.metadata.retryAfter);
    } catch (e) { if (mounted.current) showError(e); }
    finally {
      pending.current = false;
      if (mounted.current) { setRound(value => value + 1); callbacks.current.onBusyChange(false); }
    }
  }

  useEffect(() => {
    if (!readBlockedUntil) return;
    const timer = setTimeout(() => setReadBlockedUntil(0), Math.min(Math.max(0, readBlockedUntil - Date.now()), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [readBlockedUntil]);
  useEffect(() => {
    if (!auto || !pendingResource || busy || round >= 10) return;
    const resource = pendingResource === 'bind' ? bind : payment;
    const delay = Math.max(pollingDelay(round, error?.retry_after ?? resource?.metadata.retryAfter), readBlockedUntil - Date.now());
    const timer = setTimeout(() => { void refresh(pendingResource); }, Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [auto, pendingResource, busy, round, payment, bind, readBlockedUntil, error?.retry_after]);
  useEffect(() => {
    const id = bind?.body.data.policy?.id;
    if (!id || bind?.body.data.status !== 'bound' || bind.body.data.payment.attempt_status !== 'succeeded' || busy || readBlockedUntil || policyAutoRead.current === id) return;
    policyAutoRead.current = id;
    void refresh('policy');
  }, [bind, busy, readBlockedUntil]);

  async function bindPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pending.current || payment?.body.data.status !== 'approved' || bind) return;
    if (!bindAttempt.current) {
      const values = new FormData(event.currentTarget);
      const terms = String(values.get('terms') ?? '').trim();
      if (!terms || values.get('consent') !== 'on') return;
      const body: BindRequest = {
        quote_id: quoteId, plan_selection_id: selection.data.id, payment_method_id: payment.body.data.id,
        consent: { accepted_at: new Date().toISOString(), terms_version: terms },
      };
      bindAttempt.current = { key: crypto.randomUUID(), body: JSON.stringify(body) };
    }
    // Freeze the complete request, including consent time, before the first
    // send. An unknown outcome never unlocks a different purchase request.
    setBindingStarted(true); onBindingState('uncertain');
    pending.current = true; onBusyChange(true); setError(undefined);
    try {
      const result = await call<Bind>('binds', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': bindAttempt.current.key }, body: bindAttempt.current.body });
      if (mounted.current) { saveBind(result); setRound(0); setAuto(true); }
    } catch (e) {
      if (mounted.current) {
        const rejected = failure(e);
        // These API responses are recorded before any bind/charge is created.
        // Unknown outcomes, conflicts and transport failures remain frozen.
        if ((rejected.status === 400 && rejected.code === 'invalid_bind_request') ||
            (rejected.status === 422 && ['validation_error', 'payment_method_not_approved', 'payment_provider_not_approved'].includes(rejected.code ?? '')) ||
            (rejected.status === 404 && rejected.code === 'not_found')) {
          bindAttempt.current = undefined; setBindingStarted(false); onBindingState('not_started');
        }
        showError(e);
      }
    }
    finally { pending.current = false; if (mounted.current) callbacks.current.onBusyChange(false); }
  }

  return <section className="checkout" aria-label="Sandbox purchase">
    <h3>Complete sandbox purchase</h3>
    <p className="hint">Selected plan: {selection.data.id}. All recovery information stays in this browser page; a refresh loses it.</p>
    {!payment && <PaymentReferenceCollector disabled={busy} onReference={reference => { void register(reference); }} />}
    {payment && <div>
      {payment.body.data.simulated && <p className="badge">Simulated payment · no real funds or coverage</p>}
      <h4>Payment reference: {payment.body.data.status}</h4>
      <p className="hint">Reference ID: {payment.body.data.id} · {payment.body.data.provider} · {payment.body.data.type}</p>
      {payment.body.data.display.last4 && <p>{payment.body.data.display.brand ?? 'Payment method'} ending in {payment.body.data.display.last4}</p>}
      <p className="hint">Reference approval verifies the method; it does not mean a charge succeeded.</p>
      <p className="hint">Request ID: {payment.metadata.requestId ?? 'Unavailable'}</p>
      <button type="button" disabled={busy || bindingStarted || readBlockedUntil > Date.now()} onClick={() => { setRound(0); void refresh('payment'); }}>Check reference status</button>
      {!bindingStarted && <button type="button" disabled={busy} onClick={() => { setPayment(undefined); setError(undefined); }}>Use another {payment.body.data.simulated ? 'simulated' : 'Stripe'} reference</button>}
    </div>}
    {payment?.body.data.status === 'approved' && !bind && <form onSubmit={bindPlan}>
      {!bindingStarted && <fieldset disabled={busy}>
        <legend>Recorded policyholder consent</legend>
        <label>Agreed terms version<input name="terms" required maxLength={255} /></label>
        <label className="checkbox"><input name="consent" type="checkbox" required />Policyholder consent has been recorded for these terms</label>
      </fieldset>}
      {bindingStarted && <p className="hint">The original request and consent timestamp are retained. Retry it to recover the outcome; do not start another purchase.</p>}
      <button type="submit" className="primary" disabled={busy}>{bindingStarted ? 'Retry original bind request' : 'Request sandbox binding'}</button>
    </form>}
    {bind && <div role="status">
      {bind.body.data.simulated && <p className="hint">Simulator result only. No payment was charged and no real policy was issued.</p>}
      <h4>Bind status: {bind.body.data.status}</h4>
      <p className="hint">Bind ID: {bind.body.data.id}</p>
      <p>Charge status: {bind.body.data.payment.attempt_status ?? 'not reported'}</p>
      {bind.body.data.payment.failure_code && <p className="error">Payment failure: {bind.body.data.payment.failure_code}</p>}
      {pendingBind && <p>The outcome is not final. Keep checking this bind; pending status does not establish coverage.</p>}
      {bind.body.data.status === 'bound' && bind.body.data.payment.attempt_status === 'succeeded' && <p>{bind.body.data.simulated ? 'Simulated payment succeeded. The policy is a test record only.' : 'Payment succeeded. Check the policy status and effective date below for coverage.'}</p>}
      {['declined', 'payment_failed', 'cancelled'].includes(bind.body.data.status) && <p>This bind did not complete successfully. Review the returned status before starting another quote.</p>}
      <p className="hint">Request ID: {bind.metadata.requestId ?? 'Unavailable'}</p>
      <button type="button" disabled={busy || readBlockedUntil > Date.now()} onClick={() => { setRound(0); void refresh('bind'); }}>Check bind status</button>
      {bind.body.data.policy && <button type="button" disabled={busy || readBlockedUntil > Date.now()} onClick={() => { void refresh('policy'); }}>Retrieve policy</button>}
    </div>}
    {pendingResource && <div>
      <p className="hint">{auto && round < 10 ? 'Checking status automatically with backoff (up to 10 reads).' : 'Automatic checks paused. Use the status button to continue.'}</p>
      <button type="button" disabled={busy} onClick={() => { if (auto && round < 10) setAuto(false); else { setRound(0); setAuto(true); } }}>{auto && round < 10 ? 'Pause automatic checks' : 'Resume automatic checks'}</button>
    </div>}
    {readBlockedUntil > Date.now() && <p className="hint">Waiting for the API retry window before the next read.</p>}
    {policy && <section aria-label="Policy details">
      <h4>Policy details</h4>
      {policy.body.data.simulated && <p className="badge">Test policy only · no insurance coverage</p>}
      <p>Policy number: {policy.body.data.policy_number ?? 'Not assigned'}</p>
      <p>Status: {policy.body.data.status}</p>
      <p>Issue date: {policy.body.data.issued_at ?? 'Not issued'}</p>
      <p>Effective date: {policy.body.data.effective_at ?? 'Not available'}</p>
      <p>Coverage: ${policy.body.data.coverage.annual_limit.toLocaleString()} annual limit · ${policy.body.data.coverage.deductible} deductible · {policy.body.data.coverage.reimbursement_percent}% reimbursement</p>
      {policy.body.data.billing ? <p>Billing: {policy.body.data.billing.status} · {policy.body.data.billing.amount ?? 'Amount unavailable'} {policy.body.data.billing.currency} · {policy.body.data.plan} · {policy.body.data.billing.billing_source}. Next payment: {policy.body.data.billing.next_payment_at ?? 'Not available'}.</p> : <p>Billing summary not available.</p>}
      <p className="hint">Request ID: {policy.metadata.requestId ?? 'Unavailable'}. Issue and effective dates are calendar dates; policy status controls coverage.</p>
    </section>}
    {error && <div className="error" role="alert"><strong>{error.message}</strong>
      {error.code && <p>Code: {error.code}</p>}{error.request_id && <p>Request ID: {error.request_id}</p>}
      {error.retry_after && <p>Retry after: {error.retry_after} seconds.</p>}
      <p>{({ payment_provider_not_approved: 'The simulator requires sandbox access. Stripe additionally requires explicit Rainwalk approval and approved account references.',
        payment_method_not_approved: 'Check reference status. Pending or rejected references cannot be bound.',
        bind_conflict: 'A policy already exists for this quote. Recover the existing outcome; do not submit a replacement purchase.',
        permission_denied: 'Confirm payment and policy capabilities for this sandbox partner.',
      } as Record<string, string>)[error.code ?? ''] ?? 'For an unknown outcome, retry the original request or check the existing resource. Honor Retry-After.'}</p>
    </div>}
  </section>;
}
