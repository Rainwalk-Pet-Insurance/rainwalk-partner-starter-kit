import type { ApiResponse } from '@rainwalk/partner-sdk';

export type Failure = { message: string; code?: string; details?: unknown; request_id?: string; retry_after?: string; status?: number };
export async function call<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch(`/api/${path}`, { ...init, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw { ...(result.error ?? { message: 'Request failed.' }), retry_after: result.metadata?.retryAfter, status: response.status };
  return result;
}
export function failure(error: unknown): Failure {
  return error && typeof error === 'object' && 'message' in error
    ? error as Failure : { message: 'Unable to reach the local server. Retry the same request.' };
}
