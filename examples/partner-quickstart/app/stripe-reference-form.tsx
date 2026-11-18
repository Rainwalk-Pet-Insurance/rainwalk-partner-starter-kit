'use client';

import { useState, type FormEvent } from 'react';
import { createStripePaymentReference, type PaymentMethodReferenceRequest } from '@rainwalk/partner-sdk';

// Provider-specific collection stays separate from registration/binding. A
// future approved collector can emit the same API reference contract.
export function StripeReferenceForm({ disabled, onReference }: {
  disabled: boolean;
  onReference: (reference: PaymentMethodReferenceRequest) => void;
}) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      const reference = createStripePaymentReference({
        accountReference: String(values.get('account') ?? ''),
        customerReference: String(values.get('customer') ?? ''),
        paymentMethodReference: String(values.get('method') ?? ''),
        type: String(values.get('type')) as 'card' | 'bank_account',
      });
      setError(''); onReference(reference);
    } catch { setError('Enter approved Stripe account, cus_ customer and pm_ PaymentMethod references.'); }
  }
  return <form onSubmit={submit}>
    <fieldset disabled={disabled}>
      <legend>Stripe payment reference</legend>
      <p className="hint">Use references from your approved Stripe test-mode integration. Complete any customer authentication there first. This form does not collect card or bank details.</p>
      <div className="grid">
        <label>Approved account reference<input name="account" required maxLength={255} autoComplete="off" /></label>
        <label>Stripe customer reference<input name="customer" required pattern="cus_[A-Za-z0-9]+" placeholder="cus_…" maxLength={255} autoComplete="off" /></label>
        <label>Stripe PaymentMethod reference<input name="method" required pattern="pm_[A-Za-z0-9]+" placeholder="pm_…" maxLength={255} autoComplete="off" /></label>
        <label>Payment method type<select name="type"><option value="card">Card</option><option value="bank_account">Bank account</option></select></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="primary">Register payment reference</button>
    </fieldset>
  </form>;
}
