import { RainwalkApiError, RainwalkTransportError, type RainwalkClient, type QuoteRequest, type PlanSelectionRequest, type PaymentMethodReferenceRequest, type BindRequest, PaymentReferenceValidationError, BindValidationError } from '@rainwalk/partner-sdk';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// This is a loopback-only learning app, not an authenticated hosted partner service.
export async function handleRequest(request: Request, getClient: () => RainwalkClient): Promise<Response> {
  const url = new URL(request.url);
  // Next reconstructs request.url with its listener hostname (e.g. localhost),
  // which may differ from the loopback address used by the browser. Compare
  // Origin with the actual HTTP Host, validating both as local addresses.
  const host = request.headers.get('host') ?? url.host;
  const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !localHost ||
      (request.headers.has('origin') && request.headers.get('origin') !== `${url.protocol}//${host.toLowerCase()}`) ||
      request.headers.get('sec-fetch-site') === 'cross-site') {
    return json({ error: { code: 'local_only', message: 'Use this example from its local origin.' } }, 403);
  }
  const path = url.pathname.replace(/^\/api\//, '');
  const selectionRoute = /^quotes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/plan-selections$/i.exec(path);
  const resourceRoute = /^(payment-methods|binds|policies)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(path);
  try {
    let body: QuoteRequest | PlanSelectionRequest | PaymentMethodReferenceRequest | BindRequest | undefined;
    if (request.method === 'POST' && (path === 'quotes' || selectionRoute || path === 'payment-methods' || path === 'binds')) {
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: { message: 'Send application/json.' } }, 415);
      // Bound customer input before parsing or forwarding it.
      const reader = request.body?.getReader();
      if (!reader) return json({ error: { message: 'A request body is required.' } }, 400);
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32_768) { await reader.cancel(); return json({ error: { message: 'Request body is too large.' } }, 413); }
        chunks.push(value);
      }
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json({ error: { message: 'Invalid JSON.' } }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: { message: 'Send a request object.' } }, 400);
      const key = request.headers.get('idempotency-key');
      if (!key || !/^[\x20-\x7e]{1,255}$/.test(key)) return json({ error: { message: 'A valid Idempotency-Key is required.' } }, 400);
    } else if (request.method !== 'GET' || !(path === 'status' || path === 'quote-inputs' || path === 'breed-lists' || /^quotes\/[0-9a-f-]{36}$/i.test(path) || resourceRoute || path === 'payment-methods' || path === 'policies')) {
      return json({ error: { message: 'Unknown example route.' } }, 404);
    }
    const client = getClient();
    const options = { signal: request.signal, correlationId: crypto.randomUUID() };
    let result;
    if (path === 'status') result = await client.getStatus(options);
    else if (path === 'quote-inputs') result = await client.getQuoteInputOptions(options);
    else if (path === 'breed-lists') {
      const postal_code = url.searchParams.get('postal_code');
      if (!postal_code || !/^\d{5}$/.test(postal_code) || [...url.searchParams.keys()].some(k => k !== 'postal_code') || url.searchParams.getAll('postal_code').length !== 1) {
        return json({ error: { message: 'Provide one five-digit postal_code.' } }, 400);
      }
      result = await client.getBreedLists({ postal_code }, options);
    } else if (body && selectionRoute) result = await client.selectPlan(selectionRoute[1], body as PlanSelectionRequest, { ...options, idempotencyKey: request.headers.get('idempotency-key')! });
    else if (body && path === 'payment-methods') result = await client.registerPaymentMethodReference(body as PaymentMethodReferenceRequest, { ...options, idempotencyKey: request.headers.get('idempotency-key')! });
    else if (body && path === 'binds') result = await client.createBind(body as BindRequest, { ...options, idempotencyKey: request.headers.get('idempotency-key')! });
    else if (resourceRoute?.[1] === 'payment-methods') result = await client.getPaymentMethod(resourceRoute[2], options);
    else if (resourceRoute?.[1] === 'binds') result = await client.getBind(resourceRoute[2], options);
    else if (resourceRoute?.[1] === 'policies') result = await client.getPolicy(resourceRoute[2], options);
    else if (path === 'payment-methods' || path === 'policies') {
      const rawLimit = url.searchParams.get('limit');
      if ([...url.searchParams.keys()].some(key => !['limit', 'cursor'].includes(key)) ||
          [...new Set(url.searchParams.keys())].some(key => url.searchParams.getAll(key).length !== 1) ||
          (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100))) {
        return json({ error: { message: 'Use one optional limit (1–100) and cursor.' } }, 400);
      }
      const listOptions = { ...options, limit: rawLimit === null ? undefined : Number(rawLimit), cursor: url.searchParams.get('cursor') ?? undefined };
      result = path === 'payment-methods' ? await client.listPaymentMethods(listOptions) : await client.listPolicies(listOptions);
    }
    else if (body) result = await client.createQuote(body as QuoteRequest, { ...options, idempotencyKey: request.headers.get('idempotency-key')! });
    else result = await client.getQuote(path.slice('quotes/'.length), options);
    return json(result, result.status);
  } catch (error) {
    if (error instanceof BindValidationError) return json({ error: { code: 'invalid_bind_request', message: error.message } }, 400);
    if (error instanceof PaymentReferenceValidationError) return json({ error: { code: 'invalid_payment_reference', message: error.message } }, 400);
    if (error instanceof RainwalkApiError) {
      return json({ error: { code: error.code, message: error.message, details: error.details, request_id: error.requestId }, metadata: error.metadata }, error.status);
    }
    if (error instanceof RainwalkTransportError) return json({ error: { code: error.kind, message: error.message } }, error.kind === 'timeout' ? 504 : 502);
    // Do not serialize exceptions, environment values or request bodies.
    return json({ error: { code: 'configuration_error', message: 'Check the server sandbox credential and quickstart setup.' } }, 500);
  }
}
