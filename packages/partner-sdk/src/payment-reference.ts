import type { components } from './schema.js';

export type PaymentMethodReferenceRequest = components['schemas']['PaymentMethodReferenceRequest'];
export interface StripeReferenceInput {
  accountReference: string;
  customerReference: string;
  paymentMethodReference: string;
  type: 'card' | 'bank_account';
}
export class PaymentReferenceValidationError extends Error {
  readonly name = 'PaymentReferenceValidationError';
}
export type SandboxPaymentScenario = 'success' | 'decline' | 'pending' | 'rejected';
export function createSandboxPaymentReference(scenario: SandboxPaymentScenario): PaymentMethodReferenceRequest {
  if (!['success', 'decline', 'pending', 'rejected'].includes(scenario)) throw new PaymentReferenceValidationError('Choose a documented sandbox scenario.');
  return { provider: 'sandbox_simulator', provider_account_reference: 'rw_sim_account', provider_customer_reference: 'rw_sim_customer', provider_payment_method_reference: `rw_sim_${scenario}`, type: 'card' };
}

// Collecting/tokenizing a payment method belongs to the approved provider
// integration. This boundary accepts references, never card/bank details.
export function createStripePaymentReference(input: StripeReferenceInput): PaymentMethodReferenceRequest {
  const reference: PaymentMethodReferenceRequest = {
    provider: 'stripe', provider_account_reference: input.accountReference,
    provider_customer_reference: input.customerReference,
    provider_payment_method_reference: input.paymentMethodReference, type: input.type,
  };
  return validatePaymentReference(reference);
}

export function validatePaymentReference(input: PaymentMethodReferenceRequest): PaymentMethodReferenceRequest {
  const fields = ['provider', 'provider_account_reference', 'provider_customer_reference', 'provider_payment_method_reference', 'type'];
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !fields.includes(key)) ||
      fields.some(key => typeof input[key as keyof typeof input] !== 'string' || !input[key as keyof typeof input].trim() || input[key as keyof typeof input].length > 255) ||
      !['stripe', 'sandbox_simulator'].includes(input.provider) || !['card', 'bank_account'].includes(input.type)) {
    throw new PaymentReferenceValidationError('Use approved Stripe account, cus_ customer and pm_ PaymentMethod references only.');
  }
  if (input.provider === 'sandbox_simulator') {
    if (input.provider_account_reference !== 'rw_sim_account' || input.provider_customer_reference !== 'rw_sim_customer' ||
        input.type !== 'card' || !['rw_sim_success', 'rw_sim_decline', 'rw_sim_pending', 'rw_sim_rejected'].includes(input.provider_payment_method_reference)) {
      throw new PaymentReferenceValidationError('Use a documented sandbox simulator reference.');
    }
  } else if (!/^cus_[A-Za-z0-9]+$/.test(input.provider_customer_reference) || !/^pm_[A-Za-z0-9]+$/.test(input.provider_payment_method_reference) || input.provider_account_reference.startsWith('rw_sim_')) {
    throw new PaymentReferenceValidationError('Use approved Stripe references, not simulator references.');
  }
  return input;
}
