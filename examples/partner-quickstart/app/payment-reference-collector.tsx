'use client';
import { useState, type FormEvent } from 'react';
import { createSandboxPaymentReference, type SandboxPaymentScenario, type PaymentMethodReferenceRequest } from '@rainwalk/partner-sdk';
import { StripeReferenceForm } from './stripe-reference-form';

export function PaymentReferenceCollector({ disabled, onReference }: {
  disabled: boolean; onReference: (reference: PaymentMethodReferenceRequest) => void;
}) {
  const [mode, setMode] = useState('sandbox_simulator');
  function simulate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onReference(createSandboxPaymentReference(String(new FormData(event.currentTarget).get('scenario')) as SandboxPaymentScenario));
  }
  return <div>
    <label>Payment integration<select value={mode} disabled={disabled} onChange={e => setMode(e.target.value)}>
      <option value="sandbox_simulator">Sandbox simulator</option>
      <option value="stripe">Stripe (requires Rainwalk approval)</option>
    </select></label>
    {mode === 'stripe' ? <StripeReferenceForm disabled={disabled} onReference={onReference} /> : <form onSubmit={simulate}>
      <fieldset disabled={disabled}>
        <legend>Sandbox payment simulator</legend>
        <p className="hint">Available to authorized sandbox partners without a Stripe account. No real funds, billing, insurance coverage or customer email is produced. Production rejects simulation.</p>
        <label>Payment scenario<select name="scenario">
          <option value="success">Successful payment</option><option value="decline">Declined payment</option>
          <option value="pending">Pending, then successful</option><option value="rejected">Rejected payment reference</option>
        </select></label>
        <button type="submit" className="primary">Register simulated reference</button>
      </fieldset>
    </form>}
  </div>;
}
