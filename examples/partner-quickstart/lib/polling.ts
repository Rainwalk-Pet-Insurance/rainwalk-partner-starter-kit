// Only resource reads are polled; mutation replay always requires an explicit
// user action. Retry-After wins over the capped exponential backoff.
export function pollingDelay(attempt: number, retryAfter?: string | null, now = Date.now()) {
  let retryMs = 0;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    retryMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retryAfter) - now);
  }
  return Math.max(Math.min(1000 * 2 ** Math.min(attempt, 5), 30_000), Number.isFinite(retryMs) ? retryMs : 0);
}
