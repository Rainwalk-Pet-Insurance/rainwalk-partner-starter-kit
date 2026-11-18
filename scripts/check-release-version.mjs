import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function validateReleaseVersion(tag, root, sdk, app) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag) || tag !== `v${sdk.version}` || root.version !== sdk.version || app.version !== sdk.version || app.dependencies[sdk.name] !== sdk.version) {
    throw new Error('Release tag, workspace versions, and example SDK dependency must match.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const packages = await Promise.all(['package.json', 'packages/partner-sdk/package.json', 'examples/partner-quickstart/package.json'].map(async path => JSON.parse(await readFile(resolve(base, path), 'utf8'))));
  validateReleaseVersion(process.argv[2], ...packages);
}
