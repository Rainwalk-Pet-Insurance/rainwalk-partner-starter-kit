import type { components } from './schema.js';
import { validatePaymentReference, type PaymentMethodReferenceRequest } from './payment-reference.js';
export { createStripePaymentReference, createSandboxPaymentReference, PaymentReferenceValidationError } from './payment-reference.js';
export type { StripeReferenceInput, PaymentMethodReferenceRequest, SandboxPaymentScenario } from './payment-reference.js';
export type { components, paths, operations } from './schema.js';

export type QuoteRequest = components['schemas']['QuoteCreateRequest'];
export type Quote = components['schemas']['Quote'];
export type PlanSelectionRequest = components['schemas']['PlanSelectionRequest'];
export type PlanSelection = components['schemas']['PlanSelection'];
export type PaymentMethod = components['schemas']['PaymentMethod'];
export type BindRequest = components['schemas']['BindRequest'];
export type Bind = components['schemas']['Bind'];
export type Policy = components['schemas']['Policy'];
export type ListOptions = RequestOptions & { limit?: number; cursor?: string };
export type QuoteInputOptions = components['schemas']['QuoteInputOptions'];
export type BreedListOptions = components['schemas']['BreedListOptions'];
type ErrorEnvelope = components['schemas']['Error'];

export class BindValidationError extends Error {
  readonly name = 'BindValidationError';
}

export interface RequestOptions {
  signal?: AbortSignal;
  correlationId?: string;
}
export interface ResponseMetadata {
  requestId: string | null;
  correlationId: string | null;
  etag: string | null;
  retryAfter: string | null;
  rateLimit: { limit: string | null; remaining: string | null; reset: string | null };
  idempotentReplay: boolean;
}
export type ApiResponse<T> = { status: number; body: T; metadata: ResponseMetadata };
export type ConditionalResponse<T> =
  | { status: 200; body: T; metadata: ResponseMetadata }
  | { status: 304; body: undefined; metadata: ResponseMetadata };

export class RainwalkApiError extends Error {
  readonly name = 'RainwalkApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ErrorEnvelope['error']['details'] | undefined,
    readonly metadata: ResponseMetadata,
  ) { super(message); }
  get requestId() { return this.metadata.requestId; }
}

export class RainwalkTransportError extends Error {
  readonly name = 'RainwalkTransportError';
  constructor(readonly kind: 'timeout' | 'aborted' | 'network' | 'invalid_response') {
    super({ timeout: 'Rainwalk request timed out; the outcome may be unknown.',
      aborted: 'Rainwalk request cancelled; the outcome may be unknown.',
      network: 'Unable to reach Rainwalk; the outcome may be unknown.',
      invalid_response: 'Rainwalk returned an invalid JSON response.' }[kind]);
  }
}

function metadata(response: Response): ResponseMetadata {
  const h = response.headers;
  return {
    requestId: h.get('x-request-id'), correlationId: h.get('x-correlation-id'),
    etag: h.get('etag'), retryAfter: h.get('retry-after'),
    rateLimit: { limit: h.get('ratelimit-limit'), remaining: h.get('ratelimit-remaining'), reset: h.get('ratelimit-reset') },
    idempotentReplay: h.get('idempotent-replay') === 'true',
  };
}

export class RainwalkClient {
  private readonly baseUrl: string;
  readonly #apiKey: string;
  private readonly transport: typeof fetch;
  private readonly timeoutMs: number;
  constructor(options: {
    apiKey: string;
    environment: 'sandbox' | 'production';
    baseUrl?: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
  }) {
    if (typeof window !== 'undefined') throw new Error('RainwalkClient requires a server runtime.');
    if (!options.apiKey?.trim() || /[\r\n]/.test(options.apiKey)) throw new Error('A server-side API key is required.');
    if (!['sandbox', 'production'].includes(options.environment)) throw new Error('Choose sandbox or production.');
    const url = new URL(options.baseUrl ?? (options.environment === 'sandbox'
      ? 'https://dev.api.rainwalk.io/partner/v1' : 'https://api.rainwalk.io/partner/v1'));
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new Error('Use an HTTPS base URL, or HTTP on loopback, without credentials, query or fragment.');
    }
    this.baseUrl = url.toString().replace(/\/$/, '');
    this.#apiKey = options.apiKey;
    this.transport = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('timeoutMs must be positive.');
  }

  getStatus(options: RequestOptions = {}) {
    return this.request<components['schemas']['Status']>('GET', '/status', options);
  }
  getQuoteInputOptions(options: RequestOptions & { ifNoneMatch?: string } = {}) {
    return this.request<QuoteInputOptions>('GET', '/quote-inputs', options, undefined, this.conditionalHeaders(options)) as Promise<ConditionalResponse<QuoteInputOptions>>;
  }
  getBreedLists(location: { state: string; postal_code?: never } | { postal_code: string; state?: never }, options: RequestOptions & { ifNoneMatch?: string } = {}) {
    const entries = Object.entries(location);
    if (entries.length !== 1 || !['state', 'postal_code'].includes(entries[0][0]) || !entries[0][1]) {
      throw new Error('Provide exactly one of state or postal_code.');
    }
    return this.request<BreedListOptions>('GET', `/breed-lists?${new URLSearchParams(entries as [string, string][])}`, options, undefined, this.conditionalHeaders(options)) as Promise<ConditionalResponse<BreedListOptions>>;
  }
  createQuote(body: QuoteRequest, options: RequestOptions & { idempotencyKey: string }) {
    this.validateIdempotencyKey(options.idempotencyKey);
    return this.request<Quote>('POST', '/quotes', options, body, { 'Idempotency-Key': options.idempotencyKey });
  }
  selectPlan(quoteId: string, body: PlanSelectionRequest, options: RequestOptions & { idempotencyKey: string }) {
    this.validateQuoteId(quoteId);
    this.validateIdempotencyKey(options.idempotencyKey);
    return this.request<PlanSelection>('POST', `/quotes/${quoteId}/plan-selections`, options, body, { 'Idempotency-Key': options.idempotencyKey });
  }
  getQuote(quoteId: string, options: RequestOptions = {}) {
    this.validateQuoteId(quoteId);
    return this.request<Quote>('GET', `/quotes/${quoteId}`, options);
  }
  registerPaymentMethodReference(body: PaymentMethodReferenceRequest, options: RequestOptions & { idempotencyKey: string }) {
    this.validateIdempotencyKey(options.idempotencyKey);
    return this.request<PaymentMethod>('POST', '/payment-methods', options, validatePaymentReference(body), { 'Idempotency-Key': options.idempotencyKey });
  }
  getPaymentMethod(paymentMethodId: string, options: RequestOptions = {}) {
    this.validateUuid(paymentMethodId, 'paymentMethodId');
    return this.request<PaymentMethod>('GET', `/payment-methods/${paymentMethodId}`, options);
  }
  listPaymentMethods(options: ListOptions = {}) {
    return this.request<components['schemas']['PaymentMethodList']>('GET', `/payment-methods${this.pagination(options)}`, options);
  }
  createBind(body: BindRequest, options: RequestOptions & { idempotencyKey: string }) {
    this.validateIdempotencyKey(options.idempotencyKey);
    const fields = ['quote_id', 'plan_selection_id', 'payment_method_id', 'consent'];
    const consentFields = ['accepted_at', 'terms_version', 'ip_address'];
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !fields.includes(key)) ||
        !body.consent || typeof body.consent !== 'object' || Array.isArray(body.consent) ||
        Object.keys(body.consent).some(key => !consentFields.includes(key)) ||
        typeof body.consent.accepted_at !== 'string' || !Number.isFinite(Date.parse(body.consent.accepted_at)) ||
        typeof body.consent.terms_version !== 'string' || !body.consent.terms_version.trim() ||
        (body.consent.ip_address !== undefined && typeof body.consent.ip_address !== 'string')) {
      throw new BindValidationError('Use quote, selection and payment-method IDs with recorded consent only; payment data and amounts are not accepted.');
    }
    for (const id of [body.quote_id, body.plan_selection_id, body.payment_method_id]) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new BindValidationError('Bind resource identifiers must be UUIDs.');
    }
    return this.request<Bind>('POST', '/binds', options, body, { 'Idempotency-Key': options.idempotencyKey });
  }
  getBind(bindId: string, options: RequestOptions = {}) {
    this.validateUuid(bindId, 'bindId');
    return this.request<Bind>('GET', `/binds/${bindId}`, options);
  }
  getPolicy(policyId: string, options: RequestOptions = {}) {
    this.validateUuid(policyId, 'policyId');
    return this.request<Policy>('GET', `/policies/${policyId}`, options);
  }
  listPolicies(options: ListOptions = {}) {
    return this.request<components['schemas']['PolicyList']>('GET', `/policies${this.pagination(options)}`, options);
  }
  private pagination(options: ListOptions) {
    const query = new URLSearchParams();
    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error('limit must be an integer from 1 to 100.');
      query.set('limit', String(options.limit));
    }
    if (options.cursor !== undefined) query.set('cursor', options.cursor);
    return query.size ? `?${query}` : '';
  }
  private validateQuoteId(quoteId: string) {
    this.validateUuid(quoteId, 'quoteId');
  }
  private validateUuid(value: string, label: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error(`${label} must be a UUID.`);
  }
  private validateIdempotencyKey(key: string) {
    if (!key || !/^[\x20-\x7e]{1,255}$/.test(key)) throw new Error('idempotencyKey must contain 1–255 printable ASCII characters.');
  }
  private conditionalHeaders(options: { ifNoneMatch?: string }): Record<string, string> {
    return options.ifNoneMatch ? { 'If-None-Match': options.ifNoneMatch } : {};
  }
  private async request<T>(method: string, path: string, options: RequestOptions, body?: unknown, extraHeaders: HeadersInit = {}): Promise<ApiResponse<T>> {
    const headers = new Headers(extraHeaders);
    headers.set('Authorization', `Api-Key ${this.#apiKey}`);
    headers.set('Accept', 'application/json');
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.correlationId) headers.set('X-Correlation-Id', options.correlationId);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    let parsed: any;
    try {
      response = await this.transport(this.baseUrl + path, {
        method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', cache: 'no-store',
      });
      if (response.status === 304 && method === 'GET' && headers.has('If-None-Match')) {
        return { status: 304, body: undefined as T, metadata: metadata(response) };
      }
      const text = await response.text();
      try { parsed = JSON.parse(text); } catch {
        if (response.ok) throw new RainwalkTransportError('invalid_response');
      }
    } catch (error) {
      if (error instanceof RainwalkTransportError) throw error;
      throw new RainwalkTransportError(options.signal?.aborted ? 'aborted' : timeout.aborted ? 'timeout' : 'network');
    }
    const meta = metadata(response);
    if (!response.ok) {
      meta.requestId ??= typeof parsed?.error?.request_id === 'string' ? parsed.error.request_id : null;
      throw new RainwalkApiError(response.status,
        typeof parsed?.error?.code === 'string' ? parsed.error.code : 'http_error',
        typeof parsed?.error?.message === 'string' ? parsed.error.message : `Rainwalk returned HTTP ${response.status}.`,
        parsed?.error?.details, meta);
    }
    return { status: response.status, body: parsed as T, metadata: meta };
  }
}
