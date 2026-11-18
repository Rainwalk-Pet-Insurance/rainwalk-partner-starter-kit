import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';
import { validateReleaseVersion } from './check-release-version.mjs';
export const archiveRoot = 'rainwalk-partner-starter-kit';
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Only the reviewed release-files.json allowlist may enter a public archive.
async function regularSource(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = resolve(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Starter kit source cannot be a symlink: ${relative}`);
  }
  if (!(await lstat(current)).isFile()) throw new Error(`Starter kit source must be a regular file: ${relative}`);
  return readFile(current);
}

export async function buildStarterKit({ root = repositoryRoot, output = resolve(root, 'release') } = {}) {
  const sourceFiles = JSON.parse(await readFile(resolve(root, 'release-files.json'), 'utf8'));
  if (sourceFiles.some(path => typeof path !== 'string' || path.startsWith('/') || path.split('/').some(part => part === '..' || !part) || (path.includes('.env') && path !== 'examples/partner-quickstart/.env.example'))) throw new Error('Invalid release source path');
  const version = JSON.parse(await readFile(resolve(root, 'packages/partner-sdk/package.json'), 'utf8')).version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Invalid release version');
  const archiveName = `rainwalk-partner-starter-kit-${version}.zip`;
  const files = {};
  const hashes = {};
  const hash = data => createHash('sha256').update(data).digest('hex');
  for (const source of sourceFiles) {
    const destination = source;
    const bytes = await regularSource(root, source);
    files[destination] = bytes;
    hashes[destination] = hash(bytes);
  }
  const workspace = JSON.parse(files['package.json']);
  if (JSON.stringify(workspace.workspaces) !== JSON.stringify(['packages/partner-sdk', 'examples/partner-quickstart'])) {
    throw new Error('Starter kit workspace changed; review standalone packaging before publishing.');
  }

  validateReleaseVersion(`v${version}`, workspace, JSON.parse(files['packages/partner-sdk/package.json']), JSON.parse(files['examples/partner-quickstart/package.json']));
  files['starter-kit-manifest.json'] = Buffer.from(JSON.stringify({ format_version: 1, sdk_version: version, files: hashes }, null, 2) + '\n');
  const entries = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [
    `${archiveRoot}/${path}`, [new Uint8Array(bytes), { mtime: new Date('2000-01-01T00:00:00Z') }],
  ]));
  const zip = zipSync(entries, { level: 6 });
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, archiveName), zip);
  await writeFile(resolve(output, `${archiveName}.sha256`), `${hash(zip)}  ${archiveName}\n`);
  return { version, path: resolve(output, archiveName), fileCount: Object.keys(files).length, bytes: zip.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(await buildStarterKit());
}
