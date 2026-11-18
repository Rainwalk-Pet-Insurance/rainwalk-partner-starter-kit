import 'server-only';
import { RainwalkClient } from '@rainwalk/partner-sdk';
import { handleRequest } from './server';

export function handle(request: Request) {
  return handleRequest(request, () => {
    const apiKey = process.env.RAINWALK_API_KEY;
    if (!apiKey || apiKey === 'replace_with_your_sandbox_key') throw new Error('Missing sandbox credential');
    // The reference app deliberately has no production/base-URL override.
    return new RainwalkClient({ apiKey, environment: 'sandbox' });
  });
}
