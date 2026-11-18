'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiResponse, BreedListOptions, Quote, QuoteInputOptions, QuoteRequest, PlanSelection } from '@rainwalk/partner-sdk';
import { call, failure, type Failure } from '../lib/browser-api';
import { PlanSelectionForm } from './plan-selection';
import { Checkout } from './checkout';

export default function Page() {
  const [inputs, setInputs] = useState<QuoteInputOptions['data']>();
  const [breeds, setBreeds] = useState<BreedListOptions['data']>();
  const [postalCode, setPostalCode] = useState('78701');
  const [loadedZip, setLoadedZip] = useState('');
  const [species, setSpecies] = useState<'dog' | 'cat'>('dog');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure>();
  const [quote, setQuote] = useState<ApiResponse<Quote>>();
  const [purchaseSelection, setPurchaseSelection] = useState<PlanSelection>();
  const [purchaseStarted, setPurchaseStarted] = useState(false);
  const [purchasePending, setPurchasePending] = useState(false);
  const attempt = useRef<{ body: string; key: string } | undefined>(undefined);

  async function connect() {
    setBusy(true); setError(undefined);
    try {
      await call('status');
      const result = await call<QuoteInputOptions>('quote-inputs');
      setInputs(result.body.data);
    } catch (e) { setError(failure(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void connect(); }, []);

  async function loadBreeds() {
    setBusy(true); setError(undefined); setBreeds(undefined); setLoadedZip('');
    try {
      const result = await call<BreedListOptions>(`breed-lists?postal_code=${encodeURIComponent(postalCode)}`);
      setBreeds(result.body.data); setLoadedZip(postalCode);
    } catch (e) { setError(failure(e)); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (purchaseStarted || !breeds || loadedZip !== postalCode || breeds.coverage_status !== 'covered') return;
    const text = (name: string) => String(data.get(name) ?? '');
    const body: QuoteRequest = {
      policyholder: {
        first_name: text('first_name'), last_name: text('last_name'), email: text('email'), phone: text('phone'),
        address: { line1: text('line1'), city: text('city'), state: breeds.state, postal_code: postalCode },
      },
      pet: { name: text('pet_name'), species, breed: text('breed'), birth_date: text('birth_date'),
        sex: text('sex') as 'female' | 'male', spayed_or_neutered: data.get('spayed') === 'on' },
      coverage_preferences: {
        annual_limit: Number(data.get('annual_limit')) as QuoteRequest['coverage_preferences']['annual_limit'],
        deductible: Number(data.get('deductible')), reimbursement_percent: Number(data.get('reimbursement_percent')) as 70 | 80 | 90,
      },
    };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized) attempt.current = { body: serialized, key: crypto.randomUUID() };
    setBusy(true); setError(undefined); setQuote(undefined); setPurchaseSelection(undefined);
    try {
      setQuote(await call<Quote>('quotes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key }, body: attempt.current.body }));
    } catch (e) { setError(failure(e)); }
    finally { setBusy(false); }
  }

  async function retrieve() {
    if (!quote) return;
    setBusy(true); setError(undefined);
    try { setQuote(await call<Quote>(`quotes/${quote.body.data.id}`)); }
    catch (e) { setError(failure(e)); }
    finally { setBusy(false); }
  }

  const locationReady = breeds?.coverage_status === 'covered' && loadedZip === postalCode;
  return <main>
    <header><a href="https://rainwalk.io">rainwalk<span> partner lab</span></a><span className="badge">Sandbox · API v1</span></header>
    <section className="intro"><p className="eyebrow">Your first integration</p><h1>From a few details<br />to a real quote.</h1><p>Explore the partner quote flow with synthetic data. Your sandbox key stays on the local server.</p></section>
    <div className="workspace">
      <section className="card">
        <div className="sectionTitle"><span className="step">01</span><h2>Build a quote</h2></div>
        <p className="connection" role="status">{inputs ? 'Sandbox connected · form choices loaded' : busy ? 'Connecting to sandbox…' : 'Sandbox connection needed'}</p>
        {!inputs && <button disabled={busy} onClick={connect}>Connect to sandbox</button>}
        {inputs && <form onSubmit={submit}>
          <fieldset disabled={busy || purchaseStarted}>
            <legend>Location</legend>
            <div className="location"><label>ZIP code<input name="postal_code" value={postalCode} onChange={e => { setPostalCode(e.target.value); setBreeds(undefined); }} pattern="[0-9]{5}" required maxLength={5} /></label><button type="button" onClick={loadBreeds} disabled={!/^\d{5}$/.test(postalCode)}>Load breeds</button></div>
            {breeds && <p role="status">{breeds.coverage_status === 'covered' ? `Breed list loaded for ${breeds.state}. ZIP and address must match.` : `Coverage is currently unavailable in ${breeds.state}. Try another location.`}</p>}
          </fieldset>
          <fieldset disabled={busy || purchaseStarted || !locationReady}>
            <legend>Policyholder · synthetic data only</legend>
            <div className="grid">
              <label>First name<input name="first_name" defaultValue="Ava" required maxLength={256} /></label>
              <label>Last name<input name="last_name" defaultValue="Ng" required maxLength={256} /></label>
              <label>Email<input name="email" type="email" defaultValue="ava@example.test" required /></label>
              <label>Phone<input name="phone" type="tel" defaultValue="2125550123" required /></label>
              <label>Street address<input name="line1" defaultValue="1 Main St" required /></label>
              <label>City<input name="city" defaultValue="Austin" required /></label>
            </div>
            <legend>Pet</legend>
            <div className="grid">
              <label>Name<input name="pet_name" defaultValue="Mochi" required /></label>
              <label>Species<select name="species" value={species} onChange={e => setSpecies(e.target.value as 'dog' | 'cat')}>{inputs.pet.species.allowed_values.map(v => <option key={v}>{v}</option>)}</select></label>
              <label>Breed<select name="breed" key={`${loadedZip}-${species}`} required defaultValue=""><option value="" disabled>Select a breed</option>{breeds?.[species].map(v => <option key={v}>{v}</option>)}</select></label>
              <label>Birth date<input name="birth_date" type="date" defaultValue="2022-05-14" max={new Date().toISOString().slice(0, 10)} required /></label>
              <label>Sex<select name="sex">{inputs.pet.sex.allowed_values.map(v => <option key={v}>{v}</option>)}</select></label>
              <label className="checkbox"><input name="spayed" type="checkbox" defaultChecked />Spayed or neutered</label>
            </div>
            <legend>Coverage preferences</legend>
            <div className="grid">
              {(['annual_limit', 'deductible', 'reimbursement_percent'] as const).map(name => <label key={name}>{({ annual_limit: 'Annual limit ($)', deductible: 'Deductible ($)', reimbursement_percent: 'Reimbursement (%)' })[name]}<select name={name} defaultValue={inputs.coverage_preferences[name].allowed_values[0]}>{inputs.coverage_preferences[name].allowed_values.map(v => <option key={v}>{v}</option>)}</select></label>)}
            </div>
            <button className="primary" type="submit" disabled={!breeds?.[species].length}>{busy ? 'Requesting…' : 'Get sandbox quote'}</button>
            <p className="hint">Retry unchanged details to reuse the same request key. Changed details start a new quote. Keys are retained by the API for 24 hours.</p>
          </fieldset>
        </form>}
      </section>
      <aside className="card results" aria-live="polite">
        <div className="sectionTitle"><span className="step">02</span><h2>Your quote</h2></div>
        {error && <div className="error" role="alert"><strong>{error.message}</strong>{error.code && <p>Code: {error.code}</p>}{error.request_id && <p>Request ID: {error.request_id}</p>}{error.retry_after && <p>Retry after: {error.retry_after} seconds.</p>}{error.details != null && <pre>{JSON.stringify(error.details, null, 2)}</pre>}<p>{({ configuration_error: 'Add your sandbox key to .env.local and restart the app.', invalid_api_key: 'Check that the key belongs to the sandbox.', timeout: 'The outcome is unknown. Retry unchanged details with the same key.' } as Record<string, string>)[error.code ?? ''] ?? 'Check field details and sandbox permissions. For a temporary error, retry unchanged details; honor Retry-After for rate limits.'}</p></div>}
        {quote ? <>
          <p className="badge">{quote.body.data.status}</p><p className="hint">Quote ID: {quote.body.data.id}</p>
          {quote.body.data.offers.length === 0 && <p>No offers are available for this quote.</p>}
          {quote.body.data.offers.map(offer => <article className="offer" key={`${quote.body.data.id}:${offer.offer_id}`}>
            <p className="price">${offer.premium.monthly_total}<small> / month</small></p><p>${offer.premium.annual_total} annually · {offer.premium.currency}</p>
            <dl><dt>Annual limit</dt><dd>${offer.annual_limit.toLocaleString()}</dd><dt>Deductible</dt><dd>${offer.deductible}</dd><dt>Reimbursement</dt><dd>{offer.reimbursement_percent}%</dd><dt>Expires</dt><dd>{offer.expires_at}</dd></dl>
            <PlanSelectionForm quoteId={quote.body.data.id} offer={offer} busy={busy || purchaseStarted} onBusyChange={setBusy} onSelected={setPurchaseSelection} />
          </article>)}
          {purchaseSelection && <Checkout key={`${quote.body.data.id}:${purchaseSelection.data.id}`} quoteId={quote.body.data.id} selection={purchaseSelection} busy={busy} onBusyChange={setBusy} onBindingState={state => { setPurchaseStarted(state !== 'not_started'); setPurchasePending(state === 'uncertain'); }} />}
          <p className="hint">Request ID: {quote.metadata.requestId ?? 'Unavailable'}{quote.metadata.idempotentReplay ? ' · Replayed request' : ''}</p>
          <button onClick={retrieve} disabled={busy}>Retrieve saved quote</button>
          <button className="secondary" disabled={busy || purchasePending} onClick={() => { attempt.current = undefined; setQuote(undefined); setError(undefined); setPurchaseSelection(undefined); setPurchaseStarted(false); setPurchasePending(false); }}>Start a new quote</button>
        </> : <div className="empty"><span aria-hidden="true">↗</span><h3>Your first offer starts here.</h3><p>Connect to sandbox, load breeds for your ZIP, then submit the form. Returned prices appear here.</p><p className="hint">Create a quote, select a plan, then complete a sandbox purchase with the payment simulator.</p></div>}
      </aside>
    </div><footer>Partner API v1 · Server SDK + reference app · Synthetic sandbox data only</footer>
  </main>;
}
