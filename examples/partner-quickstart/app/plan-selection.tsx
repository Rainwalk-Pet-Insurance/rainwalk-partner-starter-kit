'use client';

import { useRef, useState } from 'react';
import type { ApiResponse, components, PlanSelection, PlanSelectionRequest } from '@rainwalk/partner-sdk';
import { call, failure, type Failure } from '../lib/browser-api';

export function PlanSelectionForm({ quoteId, offer, busy, onBusyChange, onSelected }: {
  quoteId: string;
  offer: components['schemas']['Offer'];
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onSelected?: (selection: PlanSelection) => void;
}) {
  const [frequency, setFrequency] = useState<PlanSelectionRequest['billing_frequency']>(offer.billing_options[0]);
  const [selection, setSelection] = useState<ApiResponse<PlanSelection>>();
  const [error, setError] = useState<Failure>();
  // A key belongs to this quote, offer and billing frequency. Switching away
  // and back must not lose recovery context after an uncertain response.
  const attempts = useRef(new Map<string, { key: string; body: string }>());
  const pending = useRef(false);

  async function select() {
    if (busy || pending.current || selection || !offer.billing_options.includes(frequency)) return;
    const body: PlanSelectionRequest = { offer_id: offer.offer_id, billing_frequency: frequency };
    const serialized = JSON.stringify(body);
    let attempt = attempts.current.get(serialized);
    if (!attempt) {
      attempt = { key: crypto.randomUUID(), body: serialized };
      attempts.current.set(serialized, attempt);
    }
    pending.current = true; onBusyChange(true); setError(undefined);
    try {
      const result = await call<PlanSelection>(`quotes/${quoteId}/plan-selections`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key }, body: attempt.body,
      });
      setSelection(result); onSelected?.(result.body);
    } catch (e) { setError(failure(e)); }
    finally { pending.current = false; onBusyChange(false); }
  }

  return <section className="planSelection" aria-label={`Plan selection for offer ${offer.offer_id}`}>
    {selection ? <div role="status">
      <h3>Plan selected</h3>
      <p className="hint">Selection ID: {selection.body.data.id}</p>
      <p>Billing: {selection.body.data.billing_frequency}</p>
      <p>Selected price: ${selection.body.data.billing_frequency === 'monthly'
        ? selection.body.data.price.premium.monthly_total : selection.body.data.price.premium.annual_total}
        {selection.body.data.billing_frequency === 'monthly' ? ' / month' : ' / year'} · {selection.body.data.price.premium.currency}</p>
      <p className="hint">Request ID: {selection.metadata.requestId ?? 'Unavailable'}{selection.metadata.idempotentReplay ? ' · Replayed request' : ''}</p>
      <p className="hint">This selection is immutable. Payment and policy issuance are separate steps.</p>
      {onSelected && <button type="button" disabled={busy} onClick={() => onSelected(selection.body)}>Use this selected plan</button>}
    </div> : <>
      <label>Billing frequency<select aria-label={`Billing frequency for offer ${offer.offer_id}`} value={frequency ?? ''} disabled={busy} onChange={e => setFrequency(e.target.value as PlanSelectionRequest['billing_frequency'])}>
        {offer.billing_options.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <button type="button" className="primary" disabled={busy || !offer.billing_options.includes(frequency)} onClick={select}>Select this plan</button>
      <p className="hint">Retry the same offer and billing frequency after a temporary error. An existing selection can be recovered after offer expiration.</p>
    </>}
    {error && <div className="error" role="alert"><strong>{error.message}</strong>
      {error.code && <p>Code: {error.code}</p>}{error.request_id && <p>Request ID: {error.request_id}</p>}
      {error.retry_after && <p>Retry after: {error.retry_after} seconds.</p>}
      {error.details != null && <pre>{JSON.stringify(error.details, null, 2)}</pre>}
      <p>{({ offer_expired: 'This offer has expired. Create a new quote for a new offer; retain the original request for recovery.',
        selection_conflict: 'This offer already has a selection with a different billing frequency. Retry the original frequency to recover it.',
        permission_denied: 'Ask your contact to enable partner.quote.select_plan for this sandbox partner.',
      } as Record<string, string>)[error.code ?? ''] ?? 'For a temporary failure, retry the same selection. Honor Retry-After when rate limited.'}</p>
    </div>}
  </section>;
}
